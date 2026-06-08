import type { Applicability } from '../models/types';

import { MetadataKeyBuilder } from '../builders/metadata-key.builder';

export function typePartitionKey(metadataTypeCode: string): string {
  return MetadataKeyBuilder.typePartitionKey(metadataTypeCode);
}

export function catalogSortKey(metadataTypeCode: string): string {
  return MetadataKeyBuilder.catalogSortKey(metadataTypeCode);
}

export function catalogPartitionKey(): string {
  return MetadataKeyBuilder.catalogPartitionKey();
}

/** Immutable type row SK per access pattern: `TYPE#METADATA#v<version>` (including v1). */
export function typeEntitySk(version: number): string {
  return MetadataKeyBuilder.typeEntitySk(version);
}

/** Legacy v1 SK used before unified `TYPE#METADATA#v1` naming. */
export const LEGACY_TYPE_ENTITY_SK_V1 = MetadataKeyBuilder.LEGACY_TYPE_ENTITY_SK_V1;

export function schemaSk(version: number): string {
  return MetadataKeyBuilder.schemaSk(version);
}

/** Legacy latest pointer for metadata types (no longer written; read only for old data). */
export function typeLatestPointerSk(): string {
  return MetadataKeyBuilder.typeLatestPointerSk();
}

export function valueSk(valueCode: string, version: number): string {
  return MetadataKeyBuilder.valueSk(valueCode, version);
}

export function valueLatestSk(valueCode: string): string {
  return MetadataKeyBuilder.valueLatestSk(valueCode);
}

/** Audit partition PK for metadata type changes (Query with `begins_with(SK, 'TIMESTAMP#')`). */
export function auditTypePartitionKey(metadataTypeCode: string): string {
  return MetadataKeyBuilder.auditTypePartitionKey(metadataTypeCode);
}

/** Audit partition PK for metadata value changes. */
export function auditValuePartitionKey(valueCode: string): string {
  return MetadataKeyBuilder.auditValuePartitionKey(valueCode);
}

/** @deprecated Use auditTypePartitionKey — same string, used as SK prefix in legacy audit rows. */
export function auditTypePrefix(metadataTypeCode: string): string {
  return MetadataKeyBuilder.auditTypePrefix(metadataTypeCode);
}

/** @deprecated Use auditValuePartitionKey */
export function auditValuePrefix(valueCode: string): string {
  return MetadataKeyBuilder.auditValuePrefix(valueCode);
}

/**
 * Builds APPL sort keys for all combinations of applicability dimensions.
 * Uses `*` when a dimension is empty (matches "any" for that segment in the key).
 */
export function buildApplSortKeys(valueCode: string, applicability: Applicability): string[] {
  return MetadataKeyBuilder.buildApplSortKeys(valueCode, applicability);
}

export function extractValueCodeFromApplSk(sk: string): string | null {
  return MetadataKeyBuilder.extractValueCodeFromApplSk(sk);
}

export function changeRequestPartitionKey(changeRequestId: string): string {
  return MetadataKeyBuilder.changeRequestPartitionKey(changeRequestId);
}

export function changeRequestMetaSortKey(): string {
  return MetadataKeyBuilder.changeRequestMetaSortKey();
}

export function changeRequestDraftPointerSortKey(
  entityType: 'type' | 'value',
  metadataValueCode?: string,
): string {
  return MetadataKeyBuilder.changeRequestDraftPointerSortKey(entityType, metadataValueCode);
}
