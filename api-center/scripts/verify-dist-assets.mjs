/**
 * Post-build check: module script URLs in dist/index.html must resolve to real JS on disk,
 * not HTML (catches mis-deploy / SPA-fallback symptoms before release).
 *
 * For production debugging, use DevTools Network on the failing chunk URL (status + response body).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(indexPath)) {
  fail(`verify-dist-assets: missing ${indexPath} — run vite build first.`);
}

const html = fs.readFileSync(indexPath, 'utf8');
const scriptMatch = html.match(/<script[^>]+type=["']module["'][^>]*src=["']([^"']+)["']/i);
if (!scriptMatch) {
  fail('verify-dist-assets: no type="module" script src found in dist/index.html');
}

const src = scriptMatch[1];
const assetsIdx = src.indexOf('/assets/');
const relativeFromDist =
  assetsIdx !== -1
    ? src.slice(assetsIdx + 1)
    : src.startsWith('/')
      ? src.replace(/^\//, '')
      : src;
const resolved = path.join(distDir, relativeFromDist);

if (!fs.existsSync(resolved)) {
  fail(`verify-dist-assets: script file missing on disk: ${resolved} (from src=${src})`);
}

const head = fs.readFileSync(resolved, 'utf8').slice(0, 512).trimStart();
if (head.startsWith('<!') || head.toLowerCase().startsWith('<html')) {
  fail(`verify-dist-assets: expected JavaScript at ${resolved}, got HTML.`);
}

console.log(`verify-dist-assets: OK (${path.relative(distDir, resolved)})`);
