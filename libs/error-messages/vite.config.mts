import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/error-messages',
  plugins: [nxViteTsPaths()],
  build: {
    outDir: '../../dist/libs/error-messages',
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: 'src/index.ts',
      name: 'error-messages',
      fileName: 'index',
      formats: ['es'],
    },
  },
});

