import type { Config } from 'jest';
import * as path from 'path';

const config: Config = {
  displayName: 'fhir',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022' } }] },
  moduleFileExtensions: ['ts', 'js'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@api-hub/terminology$': path.join(__dirname, '../terminology/src/index.ts'),
    '^@api-hub/canonical$': path.join(__dirname, '../canonical/src/index.ts'),
  },
  coverageDirectory: '../../test-output/jest/coverage/libs/fhir',
};

export default config;
