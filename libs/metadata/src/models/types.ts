import type { STATUS } from '../constants';

export type Status = (typeof STATUS)[keyof typeof STATUS];

/** Allowed values for metadata type value semantics (requirement). */
export const VALUE_DATA_TYPES = ['Enum', 'Numeric', 'Boolean', 'Text'] as const;
export type ValueDataType = (typeof VALUE_DATA_TYPES)[number];

/** Applicability stored on VALUE and used for in-memory search filtering. */
export interface Applicability {
  module: string[];
  category: string[];
  condition: string[];
  country: string[];
  language?: string[];
}

/**
 * Request body for create / update metadata type.
 *
 * **Create:** `metadataTypeCode`, `displayName` (≤100), `valueDataType`, `multiSelectAllowed`,
 * `applicableModules` (≥1), and `status` (ACTIVE|INACTIVE) are required. `description` and
 * `attributeSchema` are optional. `metadataTypeCode` is immutable after publish (new code = new type).
 *
 * **Update:** Partial fields allowed; omitted fields keep existing values where applicable.
 */
/**
 * When set on a metadata type, value-level applicability lists are required (when `isGlobal` is false)
 * for the corresponding dimension.
 */
export interface ValueApplicabilityConfig {
  moduleScoped?: boolean;
  categoryDependent?: boolean;
  conditionDependent?: boolean;
  countryDependent?: boolean;
  languageDependent?: boolean;
}

export interface MetadataTypeInput {
  metadataTypeCode: string;
  displayName?: string;
  description?: string;
  valueDataType?: ValueDataType | string;
  multiSelectAllowed?: boolean;
  applicableModules?: string[];
  /**
   * When true for a dimension, that applicability list is required on non-global metadata values.
   * Persisted on the type item as `valueApplicabilityConfig`.
   */
  valueApplicabilityConfig?: ValueApplicabilityConfig;
  /**
   * Type-level definition of which structured fields are allowed on values (`value.attributes`).
   * Persisted as `SCHEMA#vN` only for MetricCode and QuestionCode; governs validation of value attributes.
   */
  attributeSchema?: Record<string, unknown>;
  status?: Status;
  /** Optional; stored on record; defaults to actor or `system`. */
  createdBy?: string;
  lastModifiedBy?: string;
}

/** Persisted metadata type (versioned entity). System fields align with product definition (version, audit timestamps). */
export interface MetadataTypeRecord {
  metadataTypeCode: string;
  version: number;
  displayName: string;
  description?: string;
  valueDataType: ValueDataType | string;
  multiSelectAllowed: boolean;
  applicableModules: string[];
  valueApplicabilityConfig?: ValueApplicabilityConfig;
  attributeSchema?: Record<string, unknown>;
  status: Status;
  createdAt: string;
  lastModifiedAt: string;
  /** User id; may be absent on legacy reads. */
  createdBy?: string;
  /** User id; may be absent on legacy reads. */
  lastModifiedBy?: string;
}

export interface MetadataValueInput {
  /** Immutable after first write; API alias `metadataValueCode`. */
  valueCode: string;
  label: string;
  /** Optional documentation; max length enforced in validation. */
  description?: string;
  sortOrder?: number;
  /** Validators require ACTIVE | INACTIVE on every write. */
  status?: Status;
  /** Required on create; optional on update (keeps existing). */
  isGlobal?: boolean;
  /** Structured ValueAttributes; MetricCode / QuestionCode validated per type rules. */
  attributes?: Record<string, unknown>;
  applicability: Applicability;
  /** Optional; overrides Lambda user id for audit fields when provided. */
  createdBy?: string;
}

export interface MetadataValueRecord {
  metadataTypeCode: string;
  valueCode: string;
  version: number;
  label: string;
  description?: string;
  sortOrder: number;
  status: Status;
  isGlobal: boolean;
  attributes: Record<string, unknown>;
  applicability: Applicability;
  /** DynamoDB APPL rows written for this version (for delta updates). */
  applSkKeys: string[];
  createdAt: string;
  lastModifiedAt: string;
  createdBy?: string;
  lastModifiedBy?: string;
}

export interface AuditRecord {
  auditId: string;
  /** Same as `auditId` for value delta events when present. */
  eventId?: string;
  entity: 'METADATA_TYPE' | 'METADATA_VALUE';
  /** Type audits and legacy value snapshots. Value delta audits set `action`. */
  operation?: string;
  action?: 'CREATE' | 'UPDATE' | 'UPDATE_BREAKING' | 'STATUS' | string;
  actor?: string;
  changedBy?: string;
  timestamp: string;
  /** Type / legacy value full snapshot. */
  before?: unknown;
  after?: unknown;
  /** Metadata value event log: only fields that changed. */
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
}

export interface ValueSearchFilter {
  module?: string[];
  category?: string[];
  condition?: string[];
  country?: string[];
  language?: string[];
  status?: Status | string;
}

/** Single option row for applicability filter dropdowns (reference datasets). */
export interface ApplicabilityOption {
  code: string;
  label: string;
}
