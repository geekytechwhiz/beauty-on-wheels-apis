/** Shared coverage policy for alert-service Jest configs. */

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
 * Covered indirectly via consumer, mapper, and publisher tests.
 */
const schemaOnlyExclusions = [
  '!src/handlers/events/inbound/**',
  '!src/handlers/events/outbound/**',
  '!src/handlers/events/constants/**',
];

/** Default collectCoverageFrom for full alert-service runs. */
const collectCoverageFrom = [
  'src/controllers/**/*.ts',
  'src/handlers/**/*.ts',
  '!src/**/*.spec.ts',
  '!src/**/__tests__/**',
  '!src/**/*.d.ts',
  '!src/**/index.ts',
  '!src/**/health.ts',
  ...schemaOnlyExclusions,
];

module.exports = {
  coverageThreshold,
  schemaOnlyExclusions,
  collectCoverageFrom,
};
