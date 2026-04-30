/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'alert-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/alert-service',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  collectCoverageFrom: [
    'src/controllers/**/*.ts',
    'src/handlers/**/*.ts',
    // Exclusions
    '!src/**/*.spec.ts',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
    // Exclude index files
    '!src/**/index.ts',
    '!src/**/health.ts',
  ],
  verbose: true,
};
