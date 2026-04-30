import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  target: 'node18',
  clean: true,
  outDir: 'dist',
  tsconfig: 'tsconfig.lib.json',
  outExtension({ format }) {
    return { js: format === 'esm' ? '.js' : '.cjs' };
  },
});
