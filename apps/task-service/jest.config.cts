
const { readFileSync } = require('fs');
const { coverageThreshold, collectCoverageFrom } = require('./jest.coverage.cjs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'task-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/observability$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/middleware$': '<rootDir>/../../libs/middleware/src/index.ts',
    '^@api-hub/task-core$': '<rootDir>/../../libs/task-core/src/index.ts',
    '^@api-hub/event-platform$': '<rootDir>/../../libs/event-platform/src/index.ts',
    '^@api-hub/service-clients$': '<rootDir>/../../libs/service-clients/src/index.ts',
  },
  coverageDirectory: '../../coverage/apps/task-service',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],
  coverageThreshold,
  collectCoverageFrom,
  verbose: true,
};
