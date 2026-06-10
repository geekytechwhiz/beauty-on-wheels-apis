/** @type {import('jest').Config} */
module.exports = {
  displayName: 'middleware',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', { jsc: { target: 'es2022' } }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@myvitalrx/platform-tools/fhir/middleware$':
      '<rootDir>/../../libs/fhir/src/middleware/index.ts',
    '^@api-hub/observability$':
      '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/terminology$':
      '<rootDir>/../../libs/terminology/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/libs/middleware',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
  ],
};
