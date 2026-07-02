const { readFileSync } = require('fs');

const swcJestConfig = JSON.parse(readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'));
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'device-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/logger$': '<rootDir>/../../libs/logger/src/index.ts',
    '^@api-hub/observability$': '<rootDir>/../../libs/observability/src/index.ts',
  },
  coverageDirectory: '../../coverage/apps/device-service',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  collectCoverageFrom: [
    'src/handlers/**/*.ts',
    'src/services/**/*.ts',
    'src/repositories/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/__tests__/**',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/handlers/health.ts',
  ],
  verbose: true,
};