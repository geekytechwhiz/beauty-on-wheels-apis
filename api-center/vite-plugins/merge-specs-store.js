import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Before `public/` is copied to `dist`, merge `specs-store/{service}/...` into
 * `public/{specsPrefix}/` and regenerate `public/{specsPrefix}/index.json`.
 * Dev server is unchanged (`apply: 'build'` only).
 */
export function mergeSpecsStorePlugin(options = {}) {
  const raw = options.specsPrefix;
  const prefix = (raw && String(raw).trim() ? String(raw) : 'specs-store').replace(/^\/+|\/+$/g, '');
  let rootDir = process.cwd();

  return {
    name: 'merge-specs-store',
    apply: 'build',
    configResolved(config) {
      rootDir = config.root;
    },
    async buildStart() {
      const store = path.join(rootDir, 'specs-store');
      const dest = path.join(rootDir, 'public', prefix);

      if (fs.existsSync(store)) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
          if (!entry.isDirectory()) {
            continue;
          }
          fs.cpSync(path.join(store, entry.name), path.join(dest, entry.name), { recursive: true });
        }
      }

      const indexModule = path.join(rootDir, 'scripts', 'generate-spec-index.mjs');
      const { writeSpecIndexFile } = await import(pathToFileURL(indexModule).href);
      writeSpecIndexFile({ rootDir, specsPrefix: prefix });
    },
  };
}
