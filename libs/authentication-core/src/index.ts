/**
 * Identity and authentication core library: DynamoDB repositories, domain types, and authorizer types.
 */

export * from './lib/types';
export * from './lib/config/assert-identity-table';
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
