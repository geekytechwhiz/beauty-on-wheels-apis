import type { Config } from 'jest';

const config: Config = {
  displayName: 'template-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/template-core$': '<rootDir>/../../libs/template-core/src/index.ts',
    '^@api-hub/template-storage$': '<rootDir>/../../libs/template-storage/src/index.ts',
    '^@api-hub/template-dto$': '<rootDir>/../../libs/template-dto/src/index.ts',
    '^@api-hub/template-rules$': '<rootDir>/../../libs/template-rules/src/index.ts',
    '^@api-hub/template-executor$': '<rootDir>/../../libs/template-executor/src/index.ts',
    '^@api-hub/template-repository$': '<rootDir>/../../libs/template-repository/src/index.ts',
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/logger$': '<rootDir>/../../libs/logger/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/apps/template-service',
};

export default config;
