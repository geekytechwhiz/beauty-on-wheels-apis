/** @type {import('jest').Config} */
module.exports = {
  displayName: 'fhir',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', { jsc: { target: 'es2022' } }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@api-hub/logger$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/terminology$': '<rootDir>/../../libs/terminology/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/libs/fhir',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/test.ts',
    '!src/generated/**',
  ],
};
