export * from './constants';
export * from './models/types';
export * from './domain/errors';
export * from './domain/keys';
export * from './models/relation-types';
export * from './domain/relation-keys';
export * from './domain/diff';
export * from './domain/search-filter';

export { MetadataKeyBuilder } from './builders/metadata-key.builder';

export type { ListMetadataInput } from './types/list-metadata-input';
export type { IMetadataRegistryRepository, ListTypesFilter } from './repositories/metadata.repository';
export type {
  IRelationRepository,
  ListRelationsByFromOptions,
} from './repositories/relation.repository.interface';

export {
  DynamoDbMetadataRegistryRepository,
  type DynamoDbMetadataRepositoryOptions,
} from './repositories/dynamodb/metadata.repository.impl';
export {
  DynamoDbRelationRepository,
  type DynamoDbRelationRepositoryOptions,
} from './repositories/dynamodb/dynamodb-relation.repository';

export * from './validators/code-patterns';
export * from './validators/metric-code.schema';
export * from './validators/question-code.schema';
export * from './validators/schemas';
export * from './validators/validate-inputs';
export * from './validators/relation';

export * from './mappers/metadata-value-request';
export {
  flattenMetadataValueForApi,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
  type MetadataValueApiModel,
} from './mappers/metadata-request.mapper';

export {
  metadataService,
  getType,
  listTypes,
  listValues,
  upsertMetadataType,
  patchTypeStatus,
  upsertMetadataValue,
  patchValueStatus,
  getValue,
  listTypeAudit,
  listValueAudit,
  searchMetadataValues,
  parsePatchStatusBody,
  parseQueryIncludeInactive,
  parseGetEntityStatusMode,
  parseListEntityStatusMode,
  resolveMetadataTypeGet,
  resolveMetadataValueGetForApi,
  type GetEntityByStatusMode,
  type ListEntityStatusMode,
} from './services/metadata.service';

export { MetadataRegistryService } from './services/metadata-registry.service';

export {
  getMetadataRegistryDynamoContext,
  getMetadataRepository,
  getRelationRepository,
} from './dynamodb/dynamodb.client';
