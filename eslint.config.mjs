/* eslint-disable no-restricted-syntax */
import nx from '@nx/eslint-plugin';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mvrxPlugin = jiti('./tools/mvrx-eslint-plugin/src/index.ts');

export default [
  // ✅ Nx Base Configs
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],

  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      '**/swagger/**',
      '**/esbuild/**',
      '**/__tests__/**',
      '**/jest.config.*.timestamp*',
      'api-center/**',
    ],
  },

  // Nx module boundaries (options must match the rule schema — see Nx ESLint plugin docs)
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'warn',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },

  // ✅ Global baseline (allow only warn + error everywhere)
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-non-null-assertion': 'off'
    },
  },

  // ✅ Strict rule for Serverless APIs / Services
  {
    files: [
      'apps/api/**/*.ts',
      'apps/api/**/*.js',
      'services/**/*.ts',
      'services/**/*.js',
    ],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@nx/dependency-check': 'off',
      '@nx/enforce-module-boundaries': 'off',
      '@nx/use-nx-project': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      mvrx: mvrxPlugin,
    },
    rules: {
      'mvrx/no-direct-dynamodb': 'error',
      'mvrx/no-process-env-outside-config': 'error',
      'mvrx/no-controller-business-logic': 'error',
      'mvrx/enforce-platform-logger': 'error',
    },
  },
];
