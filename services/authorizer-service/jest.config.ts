import { readFileSync } from 'fs';
import type { Config } from 'jest';

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);

swcJestConfig.swcrc = false;

const config: Config = {
  displayName: 'authorizer-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: 'test-output/jest/coverage',
};

export default config;

