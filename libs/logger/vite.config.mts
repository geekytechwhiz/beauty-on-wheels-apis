/// <reference types='vitest' />
import * as fs from 'fs';
import * as path from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

function consumerPackageJson(name: string) {
  return {
    name: 'consumer-package-json',
    apply: 'build' as const,
    writeBundle(options: { dir?: string }) {
      const dir = options.dir;
      if (!dir) return;
      const pkg = {
        name,
        version: '0.0.1',
        private: true,
        type: 'module',
        types: './index.d.ts',
        main: './index.js',
        module: './index.js',
        exports: {
          '.': {
            types: './index.d.ts',
            import: './index.js',
            default: './index.js',
          },
        },
      };
      fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    },
  };
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/logger',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
    }),
    consumerPackageJson('@api-hub/logger'),
  ],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  // Configuration for building your library.
  // See: https://vite.dev/guide/build.html#library-mode
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      // Could also be a dictionary or array of multiple entry points.
      entry: 'src/index.ts',
      name: '@api-hub/logger',
      fileName: 'index',
      // Change this to the formats you want to support.
      // Don't forget to update your package.json as well.
      formats: ['es' as const],
    },
    rollupOptions: {
      // External packages that should not be bundled into your library.
      // `node:crypto` must be listed explicitly; plain `crypto` does not match `import from 'node:crypto'`,
      // and Vite would stub it as __vite-browser-external (no randomUUID).
      external: ['winston', 'crypto', 'node:crypto'],
    },
  },
}));
