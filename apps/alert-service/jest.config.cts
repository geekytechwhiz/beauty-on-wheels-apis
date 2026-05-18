
const { readFileSync } = require('fs');
const { coverageThreshold, collectCoverageFrom } = require('./jest.coverage.cjs');

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
  moduleNameMapper: {
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/observability$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/middleware$': '<rootDir>/../../libs/middleware/src/index.ts',
    '^@api-hub/alert-core$': '<rootDir>/../../libs/alert-core/src/index.ts',
    '^@api-hub/event-platform$': '<rootDir>/src/__tests__/mocks/event-platform.mock.ts',
  },
  coverageDirectory: '../../coverage/apps/alert-service',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  coverageThreshold,
  collectCoverageFrom,
  verbose: true,
};
