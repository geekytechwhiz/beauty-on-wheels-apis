import nx from '@nx/eslint-plugin';

export default [
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
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '@api-hub/event-platform',
          ],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['allowed-for-app'],
            },
            {
              sourceTag: 'type:service',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
            { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
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
