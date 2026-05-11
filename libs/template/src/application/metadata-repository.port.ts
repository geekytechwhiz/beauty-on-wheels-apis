import type {
  MetadataApplicabilityContext,
  MetadataDefinition,
} from '../domain/metadata-definition.types';

export type MetadataListStatusFilter = 'all' | 'active' | 'inactive';

export interface MetadataRepository {
  /**
   * @param metadataType Partition type segment after METADATA# (e.g. FIELD, SECTION).
   * @param name Logical metadata name (e.g. ReviewCadence).
   * @param version Optional exact version; when omitted, returns latest ACTIVE by version string sort.
   */
  getMetadata(metadataType: string, name: string, version?: string): Promise<MetadataDefinition | null>;

  /** Exact row by version (any status). */
  getMetadataExact(metadataType: string, name: string, version: string): Promise<MetadataDefinition | null>;

  /** Returns ACTIVE definitions applicable to the given context (parallel batch per type). */
  getApplicableMetadata(context: MetadataApplicabilityContext): Promise<MetadataDefinition[]>;

  /** All ACTIVE rows for a metadata partition type (validation engine / cache). */
  getAllByType(metadataType: string): Promise<MetadataDefinition[]>;

  /** Admin: all rows for partition, optionally filtered by status. */
  listMetadataByType(metadataType: string, filter: MetadataListStatusFilter): Promise<MetadataDefinition[]>;

  /** All versions for a logical name under a partition. */
  listVersionsForName(metadataType: string, name: string): Promise<MetadataDefinition[]>;

  /** Create or replace a registry row (invalidates read caches). */
  upsertMetadata(metadataType: string, definition: MetadataDefinition): Promise<void>;

  /** Hard delete a registry row (invalidates read caches). */
  deleteMetadata(metadataType: string, name: string, version: string): Promise<void>;
}
