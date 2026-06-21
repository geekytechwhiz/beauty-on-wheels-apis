const { readFileSync } = require('fs');

const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'organization-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@api-hub/event-platform$': '<rootDir>/src/__tests__/mocks/event-platform.mock.ts',
    '^(.+/handlers/events/publisher/org-config-publisher)$':
      '<rootDir>/src/__tests__/mocks/org-config-publisher.mock.ts',
  },
  coverageDirectory: 'test-output/jest/coverage',
};
