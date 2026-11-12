/// <reference types='vitest' />
import * as fs from 'fs';
import * as path from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

/** Nx remaps @api-hub/utils to this folder; a local package.json is required for types/import entrypoints. */
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

const NODE_BUILTINS = new Set([
  'crypto',
  'https',
  'http',
  'fs',
  'path',
  'url',
  'util',
  'stream',
  'buffer',
  'events',
  'os',
  'net',
  'tls',
  'zlib',
  'assert',
  'querystring',
]);

function isExternal(id: string): boolean {
  return (
    id.startsWith('@api-hub/') ||
    id.startsWith('@aws-sdk/') ||
    id.startsWith('@smithy/') ||
    id.startsWith('node:') ||
    NODE_BUILTINS.has(id) ||
    id === 'aws-lambda' ||
    id === 'libphonenumber-js' ||
    id === 'winston' ||
    id === 'zod' ||
    id === 'tslib'
  );
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/utils',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
    }),
    consumerPackageJson('@api-hub/utils'),
  ],
  // Node/Lambda library — avoid Vite browser external stubs for node: builtins.
  // See: https://vite.dev/guide/build.html#library-mode
  build: {
    ssr: true,
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: '@api-hub/utils',
      fileName: 'index',
      formats: ['es' as const],
    },
    rollupOptions: {
      external: isExternal,
    },
  },
}));
