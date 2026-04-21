import type { Config } from 'jest';

const config: Config = {
  displayName: 'template',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/template$': '<rootDir>/src/index.ts',
    '^@api-hub/template/(.*)$': '<rootDir>/src/$1',
    '^@api-hub/rule-engine$': '<rootDir>/../rule-engine/src/index.ts',
    '^@api-hub/care-plan$': '<rootDir>/src/care-plan/index.ts',
    '^@api-hub/template-core$': '<rootDir>/src/index.ts',
    '^@api-hub/template-storage$': '<rootDir>/src/infrastructure/index.ts',
    '^@api-hub/template-dto$': '<rootDir>/src/api/request.schemas.ts',
    '^@api-hub/template-rules$': '<rootDir>/../rule-engine/src/index.ts',
    '^@api-hub/template-executor$': '<rootDir>/src/application/index.ts',
    '^@api-hub/template-repository$': '<rootDir>/src/infrastructure/index.ts',
    '^@api-hub/utils$': '<rootDir>/../utils/src/index.ts',
    '^@api-hub/logger$': '<rootDir>/../logger/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/libs/template',
};

export default config;
