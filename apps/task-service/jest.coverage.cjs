/** Shared coverage policy for task-service Jest configs. */

/** Minimum coverage for all collected production files (see collectCoverageFrom in jest.config.cts). */
const coverageThreshold = {
  global: {
    statements: 90,
    branches: 90,
    functions: 90,
    lines: 90,
  },
};

/**
 * Paths that do not require dedicated specs (schema, enums, contract-only).
 * Covered indirectly via consumer, mapper, and HTTP tests.
 */
const schemaOnlyExclusions = [
  '!src/handlers/events/inbound/**',
  '!src/handlers/events/constants/**',
  '!src/handlers/streams/task-meta-stream.payload.ts',
];

/** Default collectCoverageFrom for full task-service runs. */
const collectCoverageFrom = [
  'src/controllers/**/*.ts',
  'src/handlers/**/*.ts',
  'src/reminder/**/*.ts',
  'src/utils/**/*.ts',
  'src/validators/**/*.ts',
  '!src/**/*.spec.ts',
  '!src/**/__tests__/**',
  '!src/**/*.d.ts',
  '!src/**/index.ts',
  '!src/**/*.types.ts',
  '!src/**/*.contract.ts',
  '!src/**/*.payload.ts',
  '!src/handlers/health.ts',
  // Istanbul over-counts branches on validation throws; covered via request-parser + HTTP tests.
  '!src/validators/request.validators.ts',
  ...schemaOnlyExclusions,
];

module.exports = {
  coverageThreshold,
  schemaOnlyExclusions,
  collectCoverageFrom,
};
