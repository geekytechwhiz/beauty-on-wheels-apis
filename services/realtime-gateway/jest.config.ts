import type { Config } from 'jest';
import * as path from 'path';

const config: Config = {
  displayName: 'realtime-gateway',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/logger$': path.join(__dirname, '../../libs/logger/src/index.ts'),
    '^@api-hub/integration-events$': path.join(__dirname, '../../libs/integration-events/src/index.ts'),
  },
  coverageDirectory: '../../test-output/jest/coverage/services/realtime-gateway',
};

export default config;
