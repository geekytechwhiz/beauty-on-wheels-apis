import type {
  AuditRecord,
  MetadataTypeInput,
  MetadataTypeRecord,
  MetadataValueInput,
  MetadataValueRecord,
  Status,
  ValueSearchFilter,
} from '../models/types';

export interface ListTypesFilter {
  status?: Status;
  /** Match if this module token appears in the type's applicableModules. */
  module?: string;
  valueDataType?: string;
}

/** Hydrated catalog row incl. denormalized value counts (`METADATA_TYPES` SK `TYPE#<code>`). */
export interface MetadataTypeListEntry {
  type: MetadataTypeRecord;
  activeValueCount: number;
  inactiveValueCount: number;
}

export interface ListMetadataTypesPaginatedOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface ListMetadataValuesPaginatedOptions {
  limit: number;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface IMetadataRegistryRepository {
  createMetadataType(input: MetadataTypeInput, actor?: string): Promise<MetadataTypeRecord>;
  updateMetadataType(input: MetadataTypeInput, actor?: string): Promise<MetadataTypeRecord>;
  patchMetadataTypeStatus(metadataTypeCode: string, status: Status, actor?: string): Promise<MetadataTypeRecord>;
  getMetadataType(metadataTypeCode: string): Promise<MetadataTypeRecord | null>;
  listMetadataTypes(filter: ListTypesFilter): Promise<MetadataTypeListEntry[]>;
  listMetadataTypesPaginated(
    filter: ListTypesFilter,
    options: ListMetadataTypesPaginatedOptions,
  ): Promise<{ entries: MetadataTypeListEntry[]; lastEvaluatedKey?: Record<string, unknown> }>;

  createMetadataValue(metadataTypeCode: string, input: MetadataValueInput, actor?: string): Promise<MetadataValueRecord>;
  updateMetadataValue(
    metadataTypeCode: string,
    input: MetadataValueInput,
    actor: string | undefined,
    existing: MetadataValueRecord,
  ): Promise<MetadataValueRecord>;
  patchMetadataValueStatus(metadataTypeCode: string, valueCode: string, status: Status, actor?: string): Promise<MetadataValueRecord>;
  getMetadataValue(metadataTypeCode: string, valueCode: string): Promise<MetadataValueRecord | null>;
  /** `null` = no status filter (all values). Omitted/undefined = ACTIVE only. */
  listMetadataValues(metadataTypeCode: string, status?: Status | null): Promise<MetadataValueRecord[]>;
  listMetadataValuesPaginated(
    metadataTypeCode: string,
    statusFilter: Status | null,
    options: ListMetadataValuesPaginatedOptions,
  ): Promise<{ records: MetadataValueRecord[]; lastEvaluatedKey?: Record<string, unknown> }>;
  searchMetadataValues(metadataTypeCode: string, filter: ValueSearchFilter): Promise<MetadataValueRecord[]>;

  listTypeAudit(metadataTypeCode: string): Promise<AuditRecord[]>;
  listValueAudit(metadataTypeCode: string, valueCode: string): Promise<AuditRecord[]>;
}
