import type { Config } from 'jest';

const config: Config = {
  displayName: 'rule-engine',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  coverageDirectory: '../../test-output/jest/coverage/libs/rule-engine'
};

export default config;
