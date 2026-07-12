module.exports = {
  displayName: 'identity-v1-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/identity-v1-service',
  moduleNameMapper: {
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/middleware$': '<rootDir>/../../libs/middleware/src/index.ts',
    '^@api-hub/observability$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/logger$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/event-platform$': '<rootDir>/../../libs/event-platform/src/index.ts',
  },
};
