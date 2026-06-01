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
        name: '@api-hub/fhir',
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
          './middleware': {
            types: './middleware/index.d.ts',
            import: './middleware/index.js',
            default: './middleware/index.js',
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
    id.startsWith('@ahryman40k/') ||
    id === 'tslib'
  );
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/fhir',
  resolve: {
    alias: {
      src: path.join(import.meta.dirname, 'src'),
    },
  },
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
        index: 'src/index.ts',
        'middleware/index': 'src/middleware/index.ts',
      },
      name: '@api-hub/fhir',
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ['es' as const],
    },
    rollupOptions: {
      external: isExternal,
    },
  },
}));
