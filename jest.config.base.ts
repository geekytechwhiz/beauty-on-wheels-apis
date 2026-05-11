export default {
  preset: '../../jest.preset.js',

  testEnvironment: 'node',

  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2022',
          parser: {
            syntax: 'typescript',
            decorators: true,
          },
        },
      },
    ],
  },

  moduleFileExtensions: ['ts', 'js', 'json'],

  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!**/index.ts',
    '!**/types.ts',
  ],

  setupFilesAfterEnv: [
    '<rootDir>/tools/testing/setup/jest.setup.ts',
  ],
};