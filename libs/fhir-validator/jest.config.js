/** @type {import('jest').Config} */
module.exports = {
  displayName: 'fhir-validator',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', { jsc: { target: 'es2022' } }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@api-hub/logger$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/observability$':
      '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/fhir$': '<rootDir>/../../libs/fhir/src/index.ts',
    '^@api-hub/terminology$':
      '<rootDir>/../../libs/terminology/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/libs/fhir-validator',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts'],
};
