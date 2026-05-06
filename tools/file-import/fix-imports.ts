/**
 * Monorepo maintenance: clean caches, sync tsconfig paths from /libs, validate lib configs,
 * merge app path mappings, build. Idempotent merges (never deletes existing path keys).
 *
 * Env:
 * - FIX_IMPORTS_SKIP_CLEAN=1 — skip delete / nx reset / pnpm install
 * - FIX_IMPORTS_SKIP_BUILD=1 — skip nx run-many and tsc -b
 * - FIX_IMPORTS_STRICT=1 — fail fast if pnpm install or nx reset fails (default: continue after install/reset errors so path fixes still apply)
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const INDENT = 2;

/** If false (default), pnpm install / nx reset errors do not stop tsconfig steps 4–6. */
const STRICT_INSTALL = process.env.FIX_IMPORTS_STRICT === "1";

/** tsconfig JSON allows trailing commas; use TS parser. */
function readTsconfig(filePath: string): Record<string, unknown> {
  const text = fs.readFileSync(filePath, "utf8");
  const result = ts.parseConfigFileTextToJson(filePath, text);
  if (result.error) {
    const diag = result.error;
    const msg =
      typeof diag.messageText === "string"
        ? diag.messageText
        : diag.messageText.messageText;
    throw new Error(`${filePath}: ${msg}`);
  }
  return (result.config ?? {}) as Record<string, unknown>;
}

function findRepoRoot(): string {
  let dir = __dirname;
  for (;;) {
    if (
      fs.existsSync(path.join(dir, "tsconfig.base.json")) &&
      (fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
        fs.existsSync(path.join(dir, "package.json")))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Could not find repo root (tsconfig.base.json + package.json). Run from the api-hub monorepo."
      );
    }
    dir = parent;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(data, null, INDENT)}\n`,
    "utf8"
  );
}

function rmRf(target: string, label: string): void {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`  removed ${label}: ${target}`);
}

function run(cmd: string, cwd: string, allowFail = false): boolean {
  console.log(`\n▶ ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env } });
    return true;
  } catch {
    if (!allowFail) throw new Error(`Command failed: ${cmd}`);
    console.warn("  (continuing after optional failure)");
    return false;
  }
}

function scanLibsWithIndex(libsRoot: string): string[] {
  if (!fs.existsSync(libsRoot)) return [];
  return fs
    .readdirSync(libsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) =>
      fs.existsSync(path.join(libsRoot, name, "src", "index.ts"))
    )
    .sort();
}

function buildCanonicalPaths(libNames: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of libNames) {
    out[`@api-hub/${name}`] = [`libs/${name}/src/index.ts`];
  }
  return out;
}

function mergeBasePaths(
  repoRoot: string,
  canonical: Record<string, string[]>
): { added: string[]; updated: string[] } {
  const basePath = path.join(repoRoot, "tsconfig.base.json");
  const base = readTsconfig(basePath) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  base.compilerOptions = base.compilerOptions ?? {};
  const paths = (base.compilerOptions.paths = base.compilerOptions.paths ?? {});
  const added: string[] = [];
  const updated: string[] = [];

  for (const [key, value] of Object.entries(canonical)) {
    const prev = paths[key];
    const nextJson = JSON.stringify(value);
    if (!prev) {
      paths[key] = value;
      added.push(key);
    } else if (JSON.stringify(prev) !== nextJson) {
      paths[key] = value;
      updated.push(key);
    }
  }

  writeJson(basePath, base);
  return { added, updated };
}

function validateLibTsconfig(repoRoot: string, libName: string): string[] {
  const rel = path.join("libs", libName, "tsconfig.lib.json");
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];

  const changes: string[] = [];
  const data = readTsconfig(abs) as {
    extends?: string;
    compilerOptions?: Record<string, unknown>;
  };

  if (data.extends !== "../../tsconfig.base.json") {
    if (data.extends) {
      console.warn(
        `  ${rel}: extends is "${data.extends}" (expected ../../tsconfig.base.json) — left unchanged`
      );
    } else {
      data.extends = "../../tsconfig.base.json";
      changes.push("extends");
    }
  }

  const co = (data.compilerOptions = data.compilerOptions ?? {});

  if (co.rootDir === undefined) {
    co.rootDir = "src";
    changes.push("compilerOptions.rootDir");
  }

  if (co.declaration === undefined) {
    co.declaration = true;
    changes.push("compilerOptions.declaration");
  }

  if (co.outDir === undefined) {
    co.outDir = `../../dist/libs/${libName}`;
    changes.push("compilerOptions.outDir");
  }

  if (changes.length > 0) {
    writeJson(abs, data);
    console.log(`  ${rel}: applied ${changes.join(", ")}`);
  }

  return changes;
}

function globTsconfigApp(repoRoot: string): string[] {
  const roots = ["apps", "services", "api-center"];
  const out: string[] = [];
  for (const root of roots) {
    const base = path.join(repoRoot, root);
    if (!fs.existsSync(base)) continue;
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(base, e.name, "tsconfig.app.json");
      if (fs.existsSync(p)) out.push(p);
    }
  }
  return out;
}

function mergeAppPaths(
  repoRoot: string,
  appTsconfigPath: string,
  canonical: Record<string, string[]>
): boolean {
  const data = readTsconfig(appTsconfigPath) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  data.compilerOptions = data.compilerOptions ?? {};
  const paths = (data.compilerOptions.paths = data.compilerOptions.paths ?? {});
  let changed = false;
  const added: string[] = [];

  for (const [key, value] of Object.entries(canonical)) {
    if (paths[key] === undefined) {
      paths[key] = value;
      added.push(key);
      changed = true;
    }
  }

  if (changed) {
    writeJson(appTsconfigPath, data);
    console.log(
      `  merged paths into ${path.relative(repoRoot, appTsconfigPath)}: +${added.length} (${added.slice(0, 6).join(", ")}${added.length > 6 ? ", …" : ""})`
    );
  }
  return changed;
}

function main(): void {
  const skipClean = process.env.FIX_IMPORTS_SKIP_CLEAN === "1";
  const skipBuild = process.env.FIX_IMPORTS_SKIP_BUILD === "1";

  const repoRoot = findRepoRoot();
  process.chdir(repoRoot);
  console.log(`Repo root: ${repoRoot}`);
  if (skipClean || skipBuild) {
    console.log(
      `(opts: FIX_IMPORTS_SKIP_CLEAN=${skipClean ? "1" : "0"}, SKIP_BUILD=${skipBuild ? "1" : "0"})`
    );
  }
  console.log("");

  if (!skipClean) {
    console.log("1) Clean build artifacts (dist, node_modules/.cache, tmp) …");
    rmRf(path.join(repoRoot, "dist"), "dist");
    rmRf(path.join(repoRoot, "node_modules", ".cache"), "node_modules/.cache");
    rmRf(path.join(repoRoot, "tmp"), "tmp");

    console.log("\n2) nx reset …");
    run("npx nx reset", repoRoot, !STRICT_INSTALL);

    console.log("\n3) pnpm install …");
    const installOk = run("pnpm install", repoRoot, !STRICT_INSTALL);
    if (!installOk) {
      console.warn(`
⚠ pnpm install did not finish successfully (e.g. a lifecycle script or workspace package build such as libs/observability).
  Tsconfig / path fixes (steps 4–6) still run so you can rerun without being blocked.
  After fixing the failing project, run: pnpm install
`);
    }
  } else {
    console.log("1–3) Skipped clean / nx reset / install (FIX_IMPORTS_SKIP_CLEAN=1)\n");
  }

  const libsRoot = path.join(repoRoot, "libs");
  const libNames = scanLibsWithIndex(libsRoot);
  console.log(`\nDetected ${libNames.length} libs with src/index.ts:`);
  console.log(`  ${libNames.join(", ")}`);

  const canonical = buildCanonicalPaths(libNames);
  console.log("\n4) Merge tsconfig.base.json paths …");
  const { added, updated } = mergeBasePaths(repoRoot, canonical);
  if (added.length) console.log(`  added:   ${added.join(", ")}`);
  if (updated.length) console.log(`  updated: ${updated.join(", ")}`);
  if (!added.length && !updated.length)
    console.log("  (all canonical @api-hub/* paths already match)");

  console.log("\n5) Validate libs/*/tsconfig.lib.json …");
  let libFixes = 0;
  for (const name of libNames) {
    libFixes += validateLibTsconfig(repoRoot, name).length;
  }
  if (libFixes === 0) console.log("  (no missing fields applied)");

  console.log("\n6) Merge paths into apps/**/tsconfig.app.json (additive) …");
  const appConfigs = globTsconfigApp(repoRoot);
  let appsTouched = 0;
  for (const p of appConfigs) {
    if (mergeAppPaths(repoRoot, p, canonical)) appsTouched++;
  }
  if (appsTouched === 0)
    console.log("  (no app tsconfig needed new path keys)");

  if (!skipBuild) {
    console.log("\n7) nx run-many --target=build --all …");
    run("npx nx run-many --target=build --all", repoRoot, true);

    console.log("\n8) pnpm tsc -b …");
    run("pnpm exec tsc -b", repoRoot, true);
  } else {
    console.log("\n7–8) Skipped builds (FIX_IMPORTS_SKIP_BUILD=1)");
  }

  console.log(`
✅ fix-imports finished.

Restart the TypeScript / Vue language service in your IDE:
  VS Code / Cursor: Command Palette → “TypeScript: Restart TS Server”
`);
}

main();
