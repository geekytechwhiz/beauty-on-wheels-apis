import type { Config } from 'jest';

const config: Config = {
  displayName: 'template-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/template$': '<rootDir>/../../libs/template/src/index.ts',
    '^@api-hub/template/(.*)$': '<rootDir>/../../libs/template/src/$1',
    '^@api-hub/rule-engine$': '<rootDir>/../../libs/rule-engine/src/index.ts',
    '^@api-hub/care-plan$': '<rootDir>/../../libs/template/src/care-plan/index.ts',
    '^@api-hub/template-core$': '<rootDir>/../../libs/template/src/index.ts',
    '^@api-hub/template-storage$': '<rootDir>/../../libs/template/src/infrastructure/index.ts',
    '^@api-hub/template-dto$': '<rootDir>/../../libs/template/src/api/request.schemas.ts',
    '^@api-hub/template-rules$': '<rootDir>/../../libs/rule-engine/src/index.ts',
    '^@api-hub/template-executor$': '<rootDir>/../../libs/template/src/application/index.ts',
    '^@api-hub/template-repository$': '<rootDir>/../../libs/template/src/infrastructure/index.ts',
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/logger$': '<rootDir>/../../libs/logger/src/index.ts',
  },
  coverageDirectory: '../../test-output/jest/coverage/apps/template-service',
};

export default config;
