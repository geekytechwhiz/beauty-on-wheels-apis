import type { Config } from 'jest';

const config: Config = {
  displayName: 'utils',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/error-messages$': '<rootDir>/src/helper/__mocks__/error-messages.ts',
    '^@api-hub/logger$': '<rootDir>/../logger/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/libs/utils',
};

export default config;
