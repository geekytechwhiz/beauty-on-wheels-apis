 
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'task-core',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/task-core',
  coverageReporters: ['text', 'text-summary', 'html', 'lcov', 'json-summary'],
  collectCoverageFrom: [
    // Restrict coverage scope to repository + service only.
    'src/lib/repositories/task-repository.ts',
    'src/lib/service/base-task.service.ts',
    'src/lib/service/task.service.ts',
    '!src/**/*.spec.ts',
    '!src/lib/repositories/task-repository.types.ts',
    '!src/lib/service/task.service.types.ts',
  ],
  verbose: true,
};
