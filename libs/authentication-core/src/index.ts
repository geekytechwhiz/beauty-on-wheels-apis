/**
 * Identity and authentication core library: DynamoDB repositories, domain types, and authorizer types.
 */

export * from './lib/types';
export * from './lib/config/assert-identity-table';
export * from './lib/config/cognito.config';
export * from './lib/constants/identity.constants';
export * from './lib/constants/identity-transact.constants';
export * from './lib/builder/identity-key.builder';
export * from './lib/builder/identity-entity.builder';
export * from './lib/persistence/identity-ddb.model';
export * from './lib/persistence/identity-repository.types';
export * from './lib/errors/identity.errors';
export * from './lib/repositories/UserRepository';
export * from './lib/repositories/AuthenticationRepository';
export * from './lib/services/AuthenticationService';
export * from './lib/services/UserService';
export * from './lib/auth/application-roles';
export * from './lib/auth/auth-context';
export * from './lib/auth/permissions';
export * from './lib/auth/jwks-cache';
export * from './lib/auth/token-validator';
export * from './lib/auth/authenticate';
export * from './lib/auth/authorize';
export * from './lib/auth/authorizer-context';
export * from './lib/auth/api-gateway-authorizer';
export * from './lib/auth/dynamodb-user-directory';
export * from './lib/cognito/cognito-identity.provider';
