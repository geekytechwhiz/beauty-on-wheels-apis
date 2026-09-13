module.exports = {
  displayName: 'authorizer-service',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/authorizer-service',
  moduleNameMapper: {
    '^@api-hub/utils$': '<rootDir>/../../libs/utils/src/index.ts',
    '^@api-hub/observability$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/logger$': '<rootDir>/../../libs/observability/src/index.ts',
    '^@api-hub/authentication-core$': '<rootDir>/../../libs/authentication-core/src/index.ts',
  },
};
