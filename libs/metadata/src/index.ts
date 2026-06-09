export * from './constants';
export * from './models/types';
export * from './models/change-request.types';
export * from './domain/errors';
export * from './domain/keys';
export * from './models/relation-types';
export * from './domain/relation-keys';
export { resolveRelationStorageEndpoints } from './domain/metadata-relation-orientation';
export * from './domain/diff';
export * from './domain/search-filter';
export * from './domain/lifecycle-filter';

export { encodePaginationKey, decodePaginationKey } from './lib/pagination-key';

export { MetadataKeyBuilder } from './builders/metadata-key.builder';

export type { ListMetadataInput } from './types/list-metadata-input';
export type {
  IMetadataRegistryRepository,
  ListTypesFilter,
  MetadataTypeListEntry,
} from './repositories/metadata.repository';
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
export * from './validators/attribute-schema.validator';
export * from './validators/schemas';
export * from './validators/validate-inputs';
export * from './validators/relation';
export * from './validators/registry-route.validation';
export * from './validators/status';

export * from './mappers/metadata-value-request';
export {
  flattenMetadataValueForApi,
  mergeMetadataTypeForUpdate,
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
  deleteMetadataValue,
  patchValueStatus,
  getValue,
  listTypeAudit,
  listValueAudit,
  searchMetadataValues,
  getMetadataValuesByTypes,
  type MetadataValuesByTypeApplicability,
  type MetadataValuesByTypeValue,
  type MetadataValuesByTypeItem,
  type MetadataValuesByTypesResult,
  resolveMetadataTypeGet,
  resolveMetadataValueGetForApi,
  orchestrateRegistryGet,
  orchestrateRegistryList,
  shapeRegistryListHttpResponse,
  type RegistryListHttpPayload,
  type RegistryListResult,
  orchestrateRegistryPost,
  orchestrateRegistryPostDraft,
  orchestrateRegistryPostCancelDraft,
  orchestrateRegistryPostImpactPreview,
  orchestrateRegistryPostPublish,
  publishChangeRequest,
  orchestrateRegistryPatchStatus,
  orchestrateRegistryDeleteMetadataValue,
  orchestrateRegistryListAudit,
  type RegistryGetMetadataInput,
  type RegistryPostMetadataInput,
  type RegistryPostMetadataPublishInput,
  type RegistryPostMetadataCancelInput,
  type RegistryPatchMetadataStatusInput,
  type RegistryDeleteMetadataValueInput,
  type RegistryListMetadataAuditInput,
  type ChangeRequestDraftResponse,
  type ChangeRequestCancelledResponse,
  type ImpactPreviewResponse,
  type MetadataPublishResult,
  type MetadataPublishResponse,
} from './services/metadata.service';

export { MetadataRegistryService } from './services/metadata-registry.service';

export {
  getMetadataRegistryDynamoContext,
  getMetadataRepository,
  getRelationRepository,
} from './dynamodb/dynamodb.client';

export {
  evaluateChangeImpact,
  loadChangePolicyCatalogFromFile,
  getChangePolicyCatalog,
  detectFieldChanges,
  matchPolicyRules,
  aggregateChangeImpact,
  parseChangePolicyCatalog,
  ChangePolicyCatalogError,
  type AggregatedChangeImpact,
  type ChangeImpactEvaluationInput,
  type DetectedFieldChange,
  type ChangePolicyCatalog,
  POLICY_GROUP,
  VERSION_IMPACT,
  RUNTIME_IMPACT,
  CHANGE_POLICY_OPERATION,
} from './change-policy';

export {
  PUBLISH_VERSION_STRATEGY,
  resolvePublishVersionStrategy,
  shouldSyncApplicabilityOnPublish,
  type PublishVersionStrategy,
} from './publish/publish-version.strategy';
