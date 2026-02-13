const { readFileSync } = require('fs');

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
);

swcJestConfig.swcrc = false;

/** @type {import('jest').Config} */
module.exports = {
  displayName: 'authorizer-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  watchman: false,
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: 'test-output/jest/coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/legacy/index.ts',
  ],
  // Branches 97: 3 handler branches (async/export and if-else instrumentation) stay uncovered
  coverageThreshold: {
    global: {
      branches: 97,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};

