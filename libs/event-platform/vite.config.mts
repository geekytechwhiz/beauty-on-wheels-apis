/// <reference types='vitest' />
import * as fs from 'fs';
import * as path from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

function consumerPackageJson() {
  return {
    name: 'consumer-package-json',
    apply: 'build' as const,
    writeBundle(options: { dir?: string }) {
      const dir = options.dir;
      if (!dir) return;
      const pkg = {
        name: '@api-hub/event-platform',
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
          './dx': {
            types: './dx/index.d.ts',
            import: './dx/index.js',
            default: './dx/index.js',
          },
        },
      };
      fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    },
  };
}

function isExternal(id: string): boolean {
  return (
    id.startsWith('@api-hub/') ||
    id.startsWith('@aws-sdk/') ||
    id.startsWith('@smithy/') ||
    id === 'zod' ||
    id === 'tslib' ||
    id === 'node:crypto' ||
    id === 'crypto' ||
    id === 'node:async_hooks'
  );
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/event-platform',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
    }),
    consumerPackageJson(),
  ],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: {
        index: path.join(import.meta.dirname, 'src/index.ts'),
        'dx/index': path.join(import.meta.dirname, 'src/dx/index.ts'),
      },
      name: '@api-hub/event-platform',
      fileName: (format, entryName) => `${entryName}.js`,
      formats: ['es' as const],
    },
    rollupOptions: {
      external: isExternal,
    },
  },
}));
