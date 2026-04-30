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

export interface IMetadataRegistryRepository {
  createMetadataType(input: MetadataTypeInput, actor?: string): Promise<MetadataTypeRecord>;
  updateMetadataType(input: MetadataTypeInput, actor?: string): Promise<MetadataTypeRecord>;
  patchMetadataTypeStatus(metadataTypeCode: string, status: Status, actor?: string): Promise<MetadataTypeRecord>;
  getMetadataType(metadataTypeCode: string): Promise<MetadataTypeRecord | null>;
  listMetadataTypes(filter: ListTypesFilter): Promise<MetadataTypeRecord[]>;

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
  searchMetadataValues(metadataTypeCode: string, filter: ValueSearchFilter): Promise<MetadataValueRecord[]>;

  listTypeAudit(metadataTypeCode: string): Promise<AuditRecord[]>;
  listValueAudit(metadataTypeCode: string, valueCode: string): Promise<AuditRecord[]>;
}
