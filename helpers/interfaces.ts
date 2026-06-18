export type ValueDataTypeSeed = 'Enum' | 'Numeric' | 'Boolean' | 'Text';

export type RelationTypeSeed = 'PARENT_CHILD' | 'VALID_IN' | 'SUPPORTED_BY' | 'BELONGS_TO_CATEGORY';

export interface ValueApplicabilityConfigSeed {
  moduleScoped?: boolean;
  categoryDependent?: boolean;
  conditionDependent?: boolean;
  countryDependent?: boolean;
  languageDependent?: boolean;
}

export interface MetadataTypeRelationConfigSeed {
  supportsRelations: true;
  relationType: RelationTypeSeed;
  targetMetadataTypeCode: string;
  relationFieldLabel: string;
  selectionMode: 'SINGLE' | 'MULTI';
  relationRequired: boolean;
}

export interface MetadataTypeSeedDefinition {
  metadataTypeCode: string;
  displayName: string;
  description?: string;
  valueDataType: ValueDataTypeSeed;
  multiSelectAllowed: boolean;
  applicableModules?: string[];
  valueApplicabilityConfig?: ValueApplicabilityConfigSeed;
  relation?: MetadataTypeRelationConfigSeed;
  attributeSchema?: Record<string, unknown>;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface SimpleValueSeed {
  metadataValueCode: string;
  label: string;
  description?: string;
  sortOrder?: number;
  isGlobal?: boolean;
  applicableModules?: string[];
  applicableCategories?: string[];
  applicableConditions?: string[];
  applicableCountries?: string[];
  applicableLanguages?: string[];
}

export interface RichValueSeed extends SimpleValueSeed {
  valueAttributes?: Record<string, unknown>;
  relationships?: { targetMetadataValueCode: string }[];
}

export interface MetadataTypeCreatePayload {
  metadataTypeCode: string;
  displayName: string;
  description?: string;
  valueDataType: ValueDataTypeSeed;
  multiSelectAllowed: boolean;
  applicableModules?: string[];
  valueApplicabilityConfig?: ValueApplicabilityConfigSeed;
  supportsRelations?: boolean;
  relationType?: RelationTypeSeed;
  targetMetadataTypeCode?: string;
  relationFieldLabel?: string;
  selectionMode?: 'SINGLE' | 'MULTI';
  relationRequired?: boolean;
  attributeSchema?: Record<string, unknown>;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface MetadataValueCreatePayload {
  metadataTypeCode: string;
  metadataValueCode: string;
  label: string;
  description?: string;
  sortOrder?: number;
  status: 'ACTIVE' | 'INACTIVE';
  isGlobal: boolean;
  applicableModules?: string[];
  applicableCategories?: string[];
  applicableConditions?: string[];
  applicableCountries?: string[];
  applicableLanguages?: string[];
  valueAttributes?: Record<string, unknown>;
  relationships?: { targetMetadataValueCode: string }[];
}

export interface SeedRuntimeConfig {
  baseUrl: string;
  authToken: string;
  dryRun: boolean;
  concurrency: number;
  retryMax: number;
  retryDelayMs: number;
  /** POST `/metadata/type` (append `?action=draft|publish`). */
  typePath: string;
  /** POST `/metadata/value` (append `?action=draft|publish`). */
  valuePath: string;
  /** When true, publish immediately after each successful draft (default for seeding). */
  autoPublish: boolean;
  /** Sent on `?action=publish`; set true to satisfy breaking-change confirmation. */
  confirmationAcknowledged: boolean;
  treatConflictAsSuccess: boolean;
}

export interface RegistrySnapshot {
  typesCreated: Set<string>;
  valuesByType: Map<string, Set<string>>;
}

export interface SeedResult {
  name: string;
  success: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  statusCode?: number;
  operation?: 'Add' | 'Update';
  version?: number;
  duplicate?: boolean;
  payload?: MetadataTypeCreatePayload | MetadataValueCreatePayload;
}

export interface SeedSummary {
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failedNames: string[];
  failedPayloads: {
    name: string;
    payload: MetadataTypeCreatePayload | MetadataValueCreatePayload;
    error: string;
  }[];
}

export interface ChangeRequestDraftResponse {
  changeRequestId: string;
  status: string;
  entityType: 'type' | 'value';
  operation: 'Add' | 'Update';
  metadataTypeCode: string;
  metadataValueCode?: string | null;
  baseVersion: number | null;
  createdAt: string;
  createdBy?: string;
  lastModifiedAt: string;
}

export interface MetadataPublishResponse {
  changeRequestId: string;
  changeRevision: number;
  entityType: 'type' | 'value';
  operation: 'Add' | 'Update';
  metadataTypeCode: string;
  metadataValueCode?: string | null;
  publishStrategy: string;
  version: number;
  impactSummary?: Record<string, unknown>;
  published?: Record<string, unknown>;
}

export interface ApiSuccessResponse {
  metadataTypeCode?: string;
  metadataValueCode?: string;
  valueCode?: string;
  version?: number;
  changeRequestId?: string;
  operation?: 'Add' | 'Update';
}
