#!/usr/bin/env node
/**
 * generate-local-config.js
 *
 * Reads serverless.yml as the single source of truth and generates two files
 * tailored for local development with serverless-offline:
 *
 *   1. .env.local                — env-var values resolved from AWS (SSM /
 *                                  Secrets Manager) plus literal defaults.
 *                                  Mirrored to .env so Serverless v3's
 *                                  `useDotenv: true` picks it up natively.
 *   2. serverless.offline.yml    — a clone of serverless.yml where every
 *                                  ${ssm:...} / ${secretsmanager:...} reference
 *                                  is rewritten as ${env:...} so no AWS calls
 *                                  happen during `serverless offline` startup.
 *
 * Goals: zero AWS calls at offline startup, no config drift, sub-3s execution.
 *
 * Usage (from this service directory — each api-hub app has its own copy):
 *   node scripts/generate-local-config.js [--stage dev] [--region us-east-1]
 *   pnpm run dev:prepare
 */

'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const STAGE = ARGS.stage || process.env.STAGE || 'dev';
const REGION = ARGS.region || process.env.AWS_REGION || 'us-east-1';

const ROOT = path.resolve(__dirname, '..');
const SLS_PATH = path.join(ROOT, 'serverless.yml');
const ENV_LOCAL_PATH = path.join(ROOT, '.env.local');
const ENV_PATH = path.join(ROOT, '.env');
const OFFLINE_PATH = path.join(ROOT, 'serverless.offline.yml');
const GITIGNORE_PATH = path.join(ROOT, '.gitignore');

// ---------------------------------------------------------------------------
// Bracket-aware ${...} scanner (handles arbitrary nesting)
// ---------------------------------------------------------------------------

/**
 * Walks `s` and invokes `processor(body)` for every top-level `${body}` it
 * finds. The body string preserves nested ${...} verbatim. If the processor
 * returns `null`/`undefined` the original `${body}` is kept as-is.
 */
function processVarsInString(s, processor) {
  let result = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === '$' && s[j + 1] === '{') {
          depth++;
          j += 2;
          continue;
        }
        if (s[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
        j++;
      }
      if (depth === 0) {
        const body = s.slice(i + 2, j);
        const replaced = processor(body);
        result += replaced != null ? replaced : '${' + body + '}';
        i = j + 1;
      } else {
        result += s[i++];
      }
    } else {
      result += s[i++];
    }
  }
  return result;
}

/** Splits on top-level commas (i.e. commas not nested inside ${...}). */
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '$' && s[i + 1] === '{') {
      depth++;
      i++;
    } else if (s[i] === '}' && depth > 0) {
      depth--;
    } else if (s[i] === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function stripQuotes(s) {
  if (
    s.length >= 2 &&
    ((s.startsWith("'") && s.endsWith("'")) ||
      (s.startsWith('"') && s.endsWith('"')))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Self-reference resolver (uses the serverless.yml `custom` block)
// ---------------------------------------------------------------------------

function buildSelfResolver(slsDoc) {
  const customMap = slsDoc.custom || {};

  function resolveBody(body) {
    if (body === 'self:provider.stage' || body === 'opt:stage') return STAGE;
    if (body === 'self:provider.region' || body === 'opt:region') return REGION;
    if (body === 'aws:region') return REGION;
    if (body.startsWith('self:custom.')) {
      const keyPath = body.slice('self:custom.'.length).split('.');
      let cur = customMap;
      for (const k of keyPath) {
        if (cur && typeof cur === 'object') cur = cur[k];
        else return null;
      }
      if (cur == null) return null;
      if (typeof cur === 'string') return cur;
      if (typeof cur === 'number' || typeof cur === 'boolean') return String(cur);
      return null;
    }
    return null;
  }

  function resolve(val) {
    if (typeof val !== 'string') return val;
    let prev;
    let result = val;
    let iter = 0;
    while (result !== prev && iter < 25) {
      prev = result;
      iter++;
      result = processVarsInString(result, (body) => {
        // 1. Substitute any inner ${...} first.
        const inner = processVarsInString(body, (b) => {
          const direct = resolveBody(b);
          return direct;
        });
        // 2. If the (possibly modified) body is itself a self-ref, resolve it.
        const direct = resolveBody(inner);
        if (direct != null) return direct;
        // 3. Otherwise keep the body (with inner substitutions) wrapped so the
        //    outer ${env:..., ssm:...} chain stays intact for later analysis.
        if (inner !== body) return '${' + inner + '}';
        return null;
      });
    }
    return result;
  }

  return resolve;
}

// ---------------------------------------------------------------------------
// Detect ${env:NAME, fallback...} chains and SSM/secret refs in a value
// ---------------------------------------------------------------------------

function extractAwsRefs(stringValue, resolveSelfRefs) {
  const ssmPaths = new Set();
  const secretNames = new Set();
  if (typeof stringValue !== 'string') return { ssmPaths, secretNames };

  const expanded = resolveSelfRefs(stringValue);
  // Find any `ssm:<path>` or `secretsmanager:<name>` token (until the next
  // delimiter that closes the reference).
  const ssmRe = /ssm:([^,}\s]+)/g;
  const secretRe = /secretsmanager:([^,}\s]+)/g;

  let m;
  while ((m = ssmRe.exec(expanded)) !== null) {
    let p = m[1];
    if (p.endsWith('~true')) p = p.slice(0, -'~true'.length);
    // Skip unresolved self refs.
    if (p.includes('${')) continue;
    ssmPaths.add(p);
  }
  while ((m = secretRe.exec(expanded)) !== null) {
    const n = m[1];
    if (n.includes('${')) continue;
    secretNames.add(n);
  }
  return { ssmPaths, secretNames };
}

// ---------------------------------------------------------------------------
// AWS fetchers
// ---------------------------------------------------------------------------

async function fetchSsmValues(paths, region) {
  const values = {};
  if (paths.length === 0) return values;

  const ssm = new SSMClient({ region });
  // GetParametersCommand accepts up to 10 names per call.
  const chunks = [];
  for (let i = 0; i < paths.length; i += 10) chunks.push(paths.slice(i, i + 10));

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await ssm.send(
          new GetParametersCommand({ Names: chunk, WithDecryption: true })
        );
        for (const p of res.Parameters || []) values[p.Name] = p.Value;
        for (const missing of res.InvalidParameters || []) {
          console.warn(`  ! SSM parameter not found: ${missing}`);
        }
      } catch (err) {
        console.warn(
          `  ! Failed SSM batch [${chunk.join(', ')}]: ${err.message || err}`
        );
      }
    })
  );

  return values;
}

async function fetchSecretValues(names, region) {
  const values = {};
  if (names.length === 0) return values;

  const sm = new SecretsManagerClient({ region });
  await Promise.all(
    names.map(async (name) => {
      try {
        const res = await sm.send(new GetSecretValueCommand({ SecretId: name }));
        values[name] = res.SecretString ?? '';
      } catch (err) {
        console.warn(
          `  ! Failed Secrets Manager fetch [${name}]: ${err.message || err}`
        );
      }
    })
  );
  return values;
}

// ---------------------------------------------------------------------------
// Resolve a serverless.yml env-value string to its final literal for .env.local
// ---------------------------------------------------------------------------

function resolveEnvValue(rawValue, ctx) {
  if (rawValue == null) return { value: null, resolved: false };
  if (typeof rawValue !== 'string')
    return { value: String(rawValue), resolved: true };

  const expanded = ctx.resolveSelfRefs(rawValue);
  let allResolved = true;

  const out = processVarsInString(expanded, (body) => {
    const inner = processVarsInString(body, (b) => {
      const r = resolveBody(b, ctx);
      if (r == null) allResolved = false;
      return r;
    });
    const resolved = resolveBody(inner, ctx);
    if (resolved == null) allResolved = false;
    return resolved;
  });

  return { value: out, resolved: allResolved && !out.includes('${') };
}

function resolveBody(body, ctx) {
  const parts = splitTopLevelCommas(body);
  for (const raw of parts) {
    const part = raw.trim();

    if (part.startsWith('env:')) {
      const name = part.slice(4).trim();
      // Honour real shell env if the developer overrode it.
      if (Object.prototype.hasOwnProperty.call(process.env, name)) {
        return process.env[name];
      }
      continue;
    }

    if (part.startsWith('ssm:')) {
      let p = part.slice(4).trim();
      if (p.endsWith('~true')) p = p.slice(0, -'~true'.length);
      if (Object.prototype.hasOwnProperty.call(ctx.ssmValues, p)) {
        return ctx.ssmValues[p];
      }
      continue;
    }

    if (part.startsWith('secretsmanager:')) {
      const n = part.slice('secretsmanager:'.length).trim();
      if (Object.prototype.hasOwnProperty.call(ctx.secretValues, n)) {
        return ctx.secretValues[n];
      }
      continue;
    }

    // Treat anything else in the fallback chain as a literal default.
    return stripQuotes(part);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Offline transformation: rewrite ${ssm:...} / ${secretsmanager:...} → ${env:...}
// ---------------------------------------------------------------------------

function pathToEnvKey(p) {
  const base = (p.split('/').pop() || p).replace(/~true$/, '');
  return base
    .split(/[-.]/)
    .filter(Boolean)
    .map((s) => s.toUpperCase())
    .join('_');
}

function rewriteVarBodyForOffline(body) {
  // Recurse into nested ${...} first so inner references get rewritten too.
  const innerRewritten = processVarsInString(body, rewriteVarBodyForOffline);
  const parts = splitTopLevelCommas(innerRewritten);

  const filtered = [];
  let derivedKey = null;

  for (const raw of parts) {
    const p = raw.trim();
    if (p.startsWith('ssm:')) {
      const ssmPath = p.slice(4).trim();
      if (!ssmPath.includes('${')) derivedKey = derivedKey || pathToEnvKey(ssmPath);
    } else if (p.startsWith('secretsmanager:')) {
      const sName = p.slice('secretsmanager:'.length).trim();
      if (!sName.includes('${')) derivedKey = derivedKey || pathToEnvKey(sName);
    } else {
      filtered.push(p);
    }
  }

  // Nothing AWS-related in this body — leave it alone.
  if (filtered.length === parts.length) return null;

  if (filtered.length === 0 && derivedKey) {
    filtered.push(`env:${derivedKey}`);
  }
  if (filtered.length === 0) return null;

  return '${' + filtered.join(', ') + '}';
}

/**
 * Pre-resolves every non-`${env:...}` variable reference in the offline doc so
 * Serverless Framework has effectively nothing to resolve at startup. This is
 * the biggest single win for cold-start time:
 *   - `${self:provider.stage}`     → literal stage
 *   - `${self:provider.region}`    → literal region
 *   - `${self:custom.X.Y}`         → literal value (objects/arrays are inlined
 *                                    by replacing the holding slot entirely)
 *   - `${opt:stage, 'dev'}`        → literal stage
 *   - `${opt:region, 'us-east-1'}` → literal region
 *
 * `${env:...}` references are intentionally left alone so they pick up values
 * from the generated `.env` at startup time.
 */
function preResolveOfflineDoc(doc, customMap, stage, region) {
  const lookupCustom = (keyPath) => {
    const parts = keyPath.split('.');
    let cur = customMap;
    for (const p of parts) {
      if (cur != null && typeof cur === 'object') cur = cur[p];
      else return undefined;
    }
    return cur;
  };

  // Resolve a single ${BODY} to a string literal, or `null` to leave alone.
  function resolveBodyToString(body) {
    const t = body.trim();
    if (t === 'self:provider.stage') return stage;
    if (t === 'self:provider.region') return region;
    // ${opt:stage, 'dev'}  /  ${opt:stage}
    if (t.startsWith('opt:stage')) return stage;
    if (t.startsWith('opt:region')) return region;
    if (t.startsWith('self:custom.')) {
      const v = lookupCustom(t.slice('self:custom.'.length));
      if (v == null) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      // Object/array — caller has to handle slot replacement.
      return null;
    }
    return null;
  }

  function processStringSlot(s) {
    let prev;
    let result = s;
    let iter = 0;
    while (prev !== result && iter < 25) {
      prev = result;
      iter++;
      result = processVarsInString(result, (body) => {
        // Never touch ${env:...} chains — they're resolved at runtime by
        // useDotenv reading the generated .env.
        if (body.trim().startsWith('env:')) return null;
        const inner = processVarsInString(body, (b) => {
          if (b.trim().startsWith('env:')) return null;
          return resolveBodyToString(b);
        });
        const direct = resolveBodyToString(inner);
        if (direct != null) return direct;
        if (inner !== body) return '${' + inner + '}';
        return null;
      });
    }
    return result;
  }

  function walk(node, parent, parentKey) {
    if (typeof node === 'string') {
      // If the entire string is a single self-ref to a non-string custom value,
      // splice the actual object/array into the slot.
      const objectRefMatch = node.match(/^\$\{self:custom\.([^${}]+)\}$/);
      if (objectRefMatch) {
        const v = lookupCustom(objectRefMatch[1]);
        if (
          v != null &&
          typeof v !== 'string' &&
          typeof v !== 'number' &&
          typeof v !== 'boolean'
        ) {
          parent[parentKey] = JSON.parse(JSON.stringify(v));
          walk(parent[parentKey], parent, parentKey);
          return;
        }
      }
      parent[parentKey] = processStringSlot(node);
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], node, i);
      return;
    }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], node, k);
    }
  }

  for (const k of Object.keys(doc)) walk(doc[k], doc, k);
}

function transformValueForOffline(val, pathArr, ctx) {
  if (typeof val !== 'string') return val;

  // Inline-resolve `${aws:accountId}` and `${aws:region}` so offline never
  // needs to touch STS or any other AWS service at startup.
  let next = val
    .replace(/\$\{aws:region\}/g, ctx.region)
    .replace(/\$\{aws:accountId\}/g, ctx.accountId);

  if (!/(ssm|secretsmanager):/.test(next)) return next;

  // For declared environment entries, the env-var name IS the key, so we can
  // emit a clean `${env:KEY}` regardless of how convoluted the original chain
  // was.
  const isProviderEnv =
    pathArr.length >= 3 &&
    pathArr[0] === 'provider' &&
    pathArr[1] === 'environment';
  const isFunctionEnv =
    pathArr.length >= 4 &&
    pathArr[0] === 'functions' &&
    pathArr[2] === 'environment';

  if (isProviderEnv || isFunctionEnv) {
    return '${env:' + pathArr[pathArr.length - 1] + '}';
  }

  return processVarsInString(next, rewriteVarBodyForOffline);
}

function walkAndTransform(node, transformer, ctx, parentPath = []) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      const childPath = [...parentPath, String(i)];
      if (typeof v === 'string') node[i] = transformer(v, childPath, ctx);
      else walkAndTransform(v, transformer, ctx, childPath);
    }
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      const childPath = [...parentPath, k];
      if (typeof v === 'string') node[k] = transformer(v, childPath, ctx);
      else walkAndTransform(v, transformer, ctx, childPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/**
 * Parses a minimal .env file into a plain object. We only use this to recover
 * developer-provided overrides when an AWS lookup fails, so we keep the parser
 * intentionally tiny.
 */
function readExistingEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1);
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    // Skip values that still contain `${...}` placeholders — those would have
    // been written by a previous failed run and aren't valid overrides.
    if (val.includes('${')) continue;
    out[key] = val;
  }
  return out;
}

function escapeEnvValue(v) {
  if (v == null) return '';
  const s = String(v);
  // Quote if it contains spaces, # or = so that dotenv parses it back exactly.
  if (/[\s#"'\\]/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

function ensureGitignore() {
  const lines = fs.existsSync(GITIGNORE_PATH)
    ? fs.readFileSync(GITIGNORE_PATH, 'utf8').split(/\r?\n/)
    : [];
  const want = ['.env.local', '.env', 'serverless.offline.yml', '.dev-handlers/'];
  let changed = false;
  for (const w of want) {
    if (!lines.some((l) => l.trim() === w)) {
      lines.push(w);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(GITIGNORE_PATH, lines.join('\n').replace(/\n+$/, '') + '\n');
  }
}

/**
 * Generates one tiny `.js` shim per Lambda function in `.dev-handlers/`.
 * Each shim is loaded by serverless-offline (which only checks for `.js`,
 * `.mjs`, `.cjs` extensions) the first time a route is hit, registers the
 * tsx CJS loader, then re-exports the actual TypeScript handler module.
 *
 * Net effect: cold start does ZERO TypeScript compilation. Each handler is
 * compiled on its first invocation only and then cached by Node's module
 * cache for the rest of the process lifetime.
 */
function generateLazyHandlerShims(offlineDoc) {
  const shimsDir = path.join(ROOT, '.dev-handlers');
  if (fs.existsSync(shimsDir)) {
    for (const f of fs.readdirSync(shimsDir)) {
      if (f.endsWith('.js')) fs.unlinkSync(path.join(shimsDir, f));
    }
  } else {
    fs.mkdirSync(shimsDir, { recursive: true });
  }

  if (!offlineDoc.functions || typeof offlineDoc.functions !== 'object') return;

  let count = 0;
  for (const [fnKey, fnDef] of Object.entries(offlineDoc.functions)) {
    if (!fnDef || typeof fnDef.handler !== 'string') continue;
    // handler form: "src/handlers/foo/bar.handler"  →  module="src/handlers/foo/bar", export="handler"
    const lastDot = fnDef.handler.lastIndexOf('.');
    if (lastDot <= 0) continue;
    const modulePath = fnDef.handler.slice(0, lastDot);
    const exportName = fnDef.handler.slice(lastDot + 1);

    // Path from the shim to the real source file (no extension — Node's
    // require + tsx loader pick `.ts` automatically).
    const absSource = path.resolve(ROOT, modulePath);
    let relFromShim = path.relative(shimsDir, absSource).replace(/\\/g, '/');
    if (!relFromShim.startsWith('.')) relFromShim = './' + relFromShim;

    const shim =
      `// Auto-generated by scripts/generate-local-config.js — do not edit.\n` +
      `// Lazy-loads the TypeScript handler via tsx on first invocation;\n` +
      `// subsequent invocations hit Node's require cache.\n` +
      `require('tsx/cjs');\n` +
      `module.exports = require('${relFromShim}');\n`;

    fs.writeFileSync(path.join(shimsDir, `${fnKey}.js`), shim);
    fnDef.handler = `.dev-handlers/${fnKey}.${exportName}`;
    count++;
  }
  return count;
}

/**
 * serverless-offline cannot invoke external ARN authorizers.
 * Add `localAuthorizer` beside existing `authorizer` entries for offline only.
 */
function injectLocalAuthorizers(offlineDoc) {
  if (!offlineDoc.functions || typeof offlineDoc.functions !== 'object') return 0;
  let count = 0;

  for (const fnDef of Object.values(offlineDoc.functions)) {
    if (!fnDef || !Array.isArray(fnDef.events)) continue;
    for (const evt of fnDef.events) {
      if (!evt || typeof evt !== 'object') continue;
      const http = evt.http;
      if (!http || typeof http !== 'object') continue;
      if (!http.authorizer) continue;
      if (http.localAuthorizer) continue;

      http.localAuthorizer = {
        name: 'localCommonAuthorizer',
        pathFile: 'local-authorizers.js',
        type: 'token',
      };
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  console.log(`> generate-local-config (stage=${STAGE}, region=${REGION})`);

  if (!fs.existsSync(SLS_PATH)) {
    console.error(`  x serverless.yml not found at ${SLS_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(SLS_PATH, 'utf8');
  const slsDoc = YAML.parse(raw);
  const resolveSelfRefs = buildSelfResolver(slsDoc);

  // 1. Collect every env-var declaration (provider.environment + per-function).
  const envDecls = [];
  if (slsDoc.provider && slsDoc.provider.environment) {
    for (const [k, v] of Object.entries(slsDoc.provider.environment)) {
      envDecls.push({ key: k, value: v });
    }
  }
  if (slsDoc.functions) {
    for (const fn of Object.values(slsDoc.functions)) {
      if (fn && fn.environment) {
        for (const [k, v] of Object.entries(fn.environment)) {
          envDecls.push({ key: k, value: v });
        }
      }
    }
  }

  // 2. Determine which SSM paths / secret names actually need to be fetched.
  const allSsm = new Set();
  const allSecrets = new Set();
  for (const d of envDecls) {
    const { ssmPaths, secretNames } = extractAwsRefs(
      String(d.value),
      resolveSelfRefs
    );
    ssmPaths.forEach((p) => allSsm.add(p));
    secretNames.forEach((s) => allSecrets.add(s));
  }

  console.log(
    `  · ${envDecls.length} env declarations, ${allSsm.size} unique SSM, ${allSecrets.size} unique secrets`
  );

  // 3. Fetch values from AWS (batched).
  const [ssmValues, secretValues] = await Promise.all([
    fetchSsmValues([...allSsm], REGION),
    fetchSecretValues([...allSecrets], REGION),
  ]);

  // 4. Build .env.local. Last-write-wins on duplicate keys.
  const ctx = { resolveSelfRefs, ssmValues, secretValues };
  // Existing .env.local values act as a safety-net fallback so a flaky AWS
  // call (e.g. missing IAM perms) doesn't trash the developer's setup.
  const existingEnv = readExistingEnvFile(ENV_LOCAL_PATH);
  const unresolved = [];

  const resolvedEnv = new Map();
  resolvedEnv.set('STAGE', STAGE);
  resolvedEnv.set('AWS_REGION', REGION);

  for (const d of envDecls) {
    const { value, resolved } = resolveEnvValue(String(d.value), ctx);
    if (resolved && value != null) {
      resolvedEnv.set(d.key, value);
    } else if (Object.prototype.hasOwnProperty.call(existingEnv, d.key)) {
      resolvedEnv.set(d.key, existingEnv[d.key]);
      unresolved.push(`${d.key} (kept existing override)`);
    } else {
      resolvedEnv.set(d.key, '');
      unresolved.push(`${d.key} (no value — please set in shell or AWS)`);
    }
  }
  // Keep local logs focused while running serverless-offline.
  resolvedEnv.set('LOG_LEVEL', 'error');

  if (unresolved.length > 0) {
    console.warn(`  ! ${unresolved.length} env var(s) could not be resolved from AWS:`);
    for (const u of unresolved) console.warn(`      - ${u}`);
  }

  const header = [
    '# Auto-generated by scripts/generate-local-config.js — do not edit by hand.',
    '# Re-run `pnpm run dev:prepare` to refresh values from AWS.',
    `# stage=${STAGE} region=${REGION} generatedAt=${new Date().toISOString()}`,
    '',
  ];
  const body = [...resolvedEnv.entries()].map(
    ([k, v]) => `${k}=${escapeEnvValue(v)}`
  );
  const envContents = header.concat(body).join('\n') + '\n';

  fs.writeFileSync(ENV_LOCAL_PATH, envContents, 'utf8');
  // Mirror to .env so Serverless v3's `useDotenv: true` finds it natively.
  fs.writeFileSync(ENV_PATH, envContents, 'utf8');

  // 5. Build serverless.offline.yml.
  const offlineDoc = JSON.parse(JSON.stringify(slsDoc));
  // `${aws:accountId}` would otherwise force an STS GetCallerIdentity call at
  // offline startup. Use a placeholder so offline boots without AWS creds.
  const offlineCtx = {
    region: REGION,
    accountId: process.env.AWS_ACCOUNT_ID || '000000000000',
  };
  walkAndTransform(offlineDoc, transformValueForOffline, offlineCtx);

  // Pre-resolve every remaining `${self:...}` / `${opt:...}` reference using
  // the (already AWS-rewritten) custom block as the source of truth. This
  // strips Serverless Framework's variable-resolution work from the offline
  // critical path.
  preResolveOfflineDoc(offlineDoc, offlineDoc.custom || {}, STAGE, REGION);

  // The custom block has now been fully inlined everywhere. Drop it so the
  // generated file is smaller and Serverless has nothing left to resolve.
  delete offlineDoc.custom;

  // Force the plugin list & enable native dotenv loading. We deliberately
  // drop `serverless-esbuild` for offline — handlers are loaded lazily by
  // `tsx` (registered in the npm `dev` script via `--import tsx`) the first
  // time each route is hit. That kills the up-front bundling cost of all
  // 22 handlers and is the single biggest cold-start win.
  offlineDoc.plugins = ['./plugins/serverless-offline-local-authorizers-node22.js', 'serverless-offline'];
  offlineDoc.useDotenv = true;
  // Skip schema validation during offline — the warning about `nodejs22.x`
  // wastes ~1s and adds nothing in dev.
  offlineDoc.configValidationMode = 'off';

  // So lambdas see the same stage as provider.stage (e.g. isNonProdRelaxed / event.publisher).
  if (!offlineDoc.provider.environment) {
    offlineDoc.provider.environment = {};
  }
  offlineDoc.provider.environment.LOG_LEVEL = 'error';
  offlineDoc.provider.environment.STAGE = STAGE;
  offlineDoc.provider.environment.IS_OFFLINE = 'true';

  // ---------------------------------------------------------------------
  // Local-only overrides for serverless-offline. No esbuild block since the
  // plugin isn't loaded for offline; lazy `.js` shims in .dev-handlers/
  // register `tsx/cjs` and re-export the real TypeScript handlers on demand.
  // ---------------------------------------------------------------------
  offlineDoc.custom = {
    'serverless-offline': {
      httpPort: 3000,
      // Run handlers in the same Node.js process. Worker-thread isolation
      // would prevent the tsx CJS loader (registered inside the shim on
      // first import) from being reused, costing ~150ms per cold handler.
      useInProcess: true,
      noTimeout: true,
      allowCache: true,
    },
  };

  injectLocalAuthorizers(offlineDoc);

  // 6. Generate lazy `.dev-handlers/*.js` shims and rewrite the function
  //    handler keys in the offline doc to point at them. This is what
  //    actually delivers the lazy-load: serverless-offline only finds
  //    `.js` files, but each shim is a 3-line stub that registers tsx
  //    and re-exports the corresponding `.ts` source on first invocation.
  generateLazyHandlerShims(offlineDoc);

  // Reorder so the most relevant top-level keys appear first.
  const preferredOrder = [
    'service',
    'frameworkVersion',
    'configValidationMode',
    'useDotenv',
    'plugins',
    'provider',
    'custom',
    'functions',
    'resources',
  ];
  const ordered = {};
  for (const k of preferredOrder) {
    if (Object.prototype.hasOwnProperty.call(offlineDoc, k)) ordered[k] = offlineDoc[k];
  }
  for (const k of Object.keys(offlineDoc)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, k)) ordered[k] = offlineDoc[k];
  }

  const yamlOut = YAML.stringify(ordered, {
    lineWidth: 0,
    aliasDuplicateObjects: false,
  });
  const banner =
    '# Auto-generated by scripts/generate-local-config.js — do not edit by hand.\n' +
    `# stage=${STAGE} region=${REGION}\n` +
    '# Run `pnpm run dev:prepare` to refresh from serverless.yml.\n\n';
  fs.writeFileSync(OFFLINE_PATH, banner + yamlOut, 'utf8');

  // 6. Make sure the generated artefacts stay out of git.
  ensureGitignore();

  console.log(
    `  ✓ wrote .env.local (${resolvedEnv.size} keys), .env mirror, serverless.offline.yml`
  );
  console.log(`  ✓ done in ${Date.now() - t0}ms`);
}

main().catch((err) => {
  console.error('generate-local-config failed:', err);
  process.exit(1);
});