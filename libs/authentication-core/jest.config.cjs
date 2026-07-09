/** @type {import('jest').Config} */
module.exports = {
  displayName: 'authentication-core',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }],
  },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/utils$': '<rootDir>/../utils/src/index.ts',
    '^@api-hub/observability$': '<rootDir>/../observability/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/libs/authentication-core',
};
