/** @type {import('jest').Config} */
export default {
  displayName: 'metadata-registry-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/metadata$': '<rootDir>/../../libs/metadata/src/index.ts',
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/observability$': '<rootDir>/../../libs/observability/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/apps/metadata-registry-service',
};
