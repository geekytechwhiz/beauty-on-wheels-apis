/* eslint-disable no-restricted-syntax */
import nx from '@nx/eslint-plugin';

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
    ],
  },

  // NX Module Boundary Rules
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'warn',
        {
          selector: "Property[key.name='rules']",
          message:
            'Defining ESLint rules at project level is not allowed. Use root config only.',
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
      // Completely block console usage
      'no-console': 'error',

      // Enforce logger usage instead of console
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='console']",
          message: 'Use logger instead of console in serverless APIs/services',
        },
      ],
    },
  },
];
