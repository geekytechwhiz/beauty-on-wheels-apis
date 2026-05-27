import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    ignores: ['**/.esbuild/**', '.esbuild/**', '**/dist/**', '**/out-tsc'],
  },
];
