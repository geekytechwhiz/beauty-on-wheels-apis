import type { Config } from 'jest';

const config: Config = {
  displayName: 'template-core',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  coverageDirectory: '../../test-output/jest/coverage/libs/template-core',
};

export default config;
