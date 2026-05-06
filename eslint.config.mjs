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
      /**
       * 🚫 STRICT LOGGING POLICY
       */
      'no-console': ['error', { allow: ['error', 'error'] }],

      'no-restricted-syntax': [
        'error',
 
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name='log']",
          message:
            'console.log is forbidden. Use structured logger (e.g. @shared/logger).',
        },

        // ❌ Block console.debug
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name='debug']",
          message: 'console.debug is not allowed in production code.',
        },
      ],
 
      'no-restricted-imports': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '@api-hub/event-platform',
          ],
          depConstraints: [
            {
              name: 'console',
              message: 'Do not use console directly. Use logger service.',
            },
          ],
        },
      ],

    
      'no-debugger': 'error',

    
      'no-warning-comments': [
        'warn',
        {
          terms: ['console.log', 'todo', 'fixme'],
          location: 'anywhere',
        },
      ],

    
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',

      
      'no-var': 'error',
      'prefer-const': 'error',
    },
  }, 
  {
    files: ['**/.eslintrc.json', '**/eslint.config.*'],
    rules: {
      /**
       * This prevents teams from redefining rules silently
       */
      'no-restricted-syntax': [
        'error',
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
