import type { Config } from 'jest';
import * as path from 'path';

const config: Config = {
  displayName: 'outbound-delivery',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/integration-events$': path.join(__dirname, '../../libs/integration-events/src/index.ts'),
  },
  coverageDirectory: '../../test-output/jest/coverage/services/outbound-delivery',
};

export default config;
