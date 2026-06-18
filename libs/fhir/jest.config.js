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
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@api-hub/logger$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/observability$':
      '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/middleware$':
      '<rootDir>/../../libs/middleware/src/index.ts',
    '^@api-hub/fhir$': '<rootDir>/src/index.ts',
    '^@myvitalrx/platform-tools/fhir/middleware$': '<rootDir>/src/middleware/index.ts',
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/terminology$': '<rootDir>/../../libs/terminology/src/index.ts',
    '^@api-hub/fhir-validator$':
      '<rootDir>/../../libs/fhir-validator/src/index.ts',
    '^@myvitalrx/fhir-wrapper/middleware$': '<rootDir>/src/middleware/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/libs/fhir',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/test.ts',
    '!src/generated/**',
  ],
};
