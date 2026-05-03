import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

/** api-center package root (parent of `vite-plugins/`), independent of Vite `config.root` / `process.cwd()`. */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Before `public/` is copied to `dist`, merge `specs-store/{service}/...` into
 * `public/{specsPrefix}/` and regenerate `public/{specsPrefix}/index.json`.
 * Dev server is unchanged (`apply: 'build'` only).
 */
export function mergeSpecsStorePlugin(options = {}) {
  const raw = options.specsPrefix;
  const prefix = (raw && String(raw).trim() ? String(raw) : 'specs-store').replace(/^\/+|\/+$/g, '');

  return {
    name: 'merge-specs-store',
    apply: 'build',
    async buildStart() {
      const store = path.join(packageRoot, 'specs-store');
      const dest = path.join(packageRoot, 'public', prefix);

      if (fs.existsSync(store)) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
          if (!entry.isDirectory()) {
            continue;
          }
          fs.cpSync(path.join(store, entry.name), path.join(dest, entry.name), { recursive: true });
        }
      }

      const indexModule = path.join(packageRoot, 'scripts', 'generate-spec-index.mjs');
      const { writeSpecIndexFile } = await import(pathToFileURL(indexModule).href);
      writeSpecIndexFile({ rootDir: packageRoot, specsPrefix: prefix });
    },
  };
}
