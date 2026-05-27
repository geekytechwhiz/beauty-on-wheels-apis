/// <reference types='vitest' />
import * as path from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

function isExternal(id: string): boolean {
  return (
    id.startsWith('@api-hub/') ||
    id.startsWith('@myvitalrx/') ||
    id.startsWith('@aws-sdk/') ||
    id.startsWith('@smithy/') ||
    id.startsWith('node:') ||
    id === 'crypto' ||
    id === 'zod' ||
    id === 'tslib'
  );
}

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/middleware',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
    }),
  ],
  build: {
    ssr: true,
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: path.join(import.meta.dirname, 'src/index.ts'),
      name: '@api-hub/middleware',
      fileName: 'index',
      formats: ['es' as const],
    },
    rollupOptions: {
      external: isExternal,
    },
  },
}));
