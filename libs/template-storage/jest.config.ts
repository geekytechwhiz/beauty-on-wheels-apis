import type { Config } from 'jest';

const config: Config = {
  displayName: 'template-storage',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  coverageDirectory: '../../test-output/jest/coverage/libs/template-storage',
};

export default config;
