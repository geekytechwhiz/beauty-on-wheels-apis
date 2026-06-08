import type {
  AuditRecord,
  MetadataTypeInput,
  MetadataTypeRecord,
  MetadataValueInput,
  MetadataValueRecord,
  Status,
  ValueSearchFilter,
} from '../models/types';
import type { ChangeRequestRecord } from '../models/change-request.types';

export interface ListTypesFilter {
  /** When set, type must have one of these statuses. */
  statuses?: Status[];
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
  /** Overwrite the current published type version without incrementing version (display-only publish). */
  updateMetadataTypeInPlace(
    input: MetadataTypeInput,
    actor: string | undefined,
    existing: MetadataTypeRecord,
  ): Promise<MetadataTypeRecord>;
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
  /** Overwrite the current published value version without incrementing version (display-only publish). */
  updateMetadataValueInPlace(
    metadataTypeCode: string,
    input: MetadataValueInput,
    actor: string | undefined,
    existing: MetadataValueRecord,
    options: { syncApplicability: boolean },
  ): Promise<MetadataValueRecord>;
  patchMetadataValueStatus(metadataTypeCode: string, valueCode: string, status: Status, actor?: string): Promise<MetadataValueRecord>;
  /** Immutable version with status DELETED; does not remove applicability rows or prior versions. */
  softDeleteMetadataValue(
    metadataTypeCode: string,
    valueCode: string,
    opts: { reason?: string; actor?: string },
  ): Promise<MetadataValueRecord>;
  getMetadataValue(metadataTypeCode: string, valueCode: string): Promise<MetadataValueRecord | null>;
  listMetadataValues(metadataTypeCode: string, statuses: Status[]): Promise<MetadataValueRecord[]>;
  listMetadataValuesPaginated(
    metadataTypeCode: string,
    statuses: Status[],
    options: ListMetadataValuesPaginatedOptions,
  ): Promise<{ records: MetadataValueRecord[]; lastEvaluatedKey?: Record<string, unknown> }>;
  searchMetadataValues(metadataTypeCode: string, filter: ValueSearchFilter): Promise<MetadataValueRecord[]>;

  listTypeAudit(metadataTypeCode: string): Promise<AuditRecord[]>;
  listValueAudit(metadataTypeCode: string, valueCode: string): Promise<AuditRecord[]>;

  /** Persist a change-request draft; replaces any prior DRAFT for the same entity. */
  saveChangeRequestDraft(record: ChangeRequestRecord): Promise<ChangeRequestRecord>;
  getChangeRequest(changeRequestId: string): Promise<ChangeRequestRecord | null>;
  markChangeRequestPublished(
    changeRequestId: string,
    params: { actor?: string; publishedAt: string },
  ): Promise<ChangeRequestRecord>;
  getChangeRequestDraftPointer(
    metadataTypeCode: string,
    entityType: 'type' | 'value',
    metadataValueCode?: string,
  ): Promise<{ changeRequestId: string } | null>;
}