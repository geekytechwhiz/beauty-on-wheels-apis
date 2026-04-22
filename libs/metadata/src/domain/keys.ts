import { APPL_WILDCARD, TYPE_INDEX_PK, TYPE_INDEX_SK_PREFIX } from './constants';

export function typePartitionKey(metadataTypeCode: string): string {
  return `METADATA_TYPE#${metadataTypeCode}`;
}

export function catalogSortKey(metadataTypeCode: string): string {
  return `${TYPE_INDEX_SK_PREFIX}${metadataTypeCode}`;
}

export function catalogPartitionKey(): string {
  return TYPE_INDEX_PK;
}

/** Immutable type row SK per access pattern: `TYPE#METADATA#v<version>` (including v1). */
export function typeEntitySk(version: number): string {
  return `TYPE#METADATA#v${version}`;
}

/** Legacy v1 SK used before unified `TYPE#METADATA#v1` naming. */
export const LEGACY_TYPE_ENTITY_SK_V1 = 'TYPE#METADATA' as const;

export function schemaSk(version: number): string {
  return `SCHEMA#v${version}`;
}

/** Legacy latest pointer for metadata types (no longer written; read only for old data). */
export function typeLatestPointerSk(): string {
  return 'TYPE_LATEST#METADATA';
}

export function valueSk(valueCode: string, version: number): string {
  return `VALUE#${valueCode}#v${version}`;
}

export function valueLatestSk(valueCode: string): string {
  return `VALUE_LATEST#${valueCode}`;
}

/** Audit partition PK for metadata type changes (Query with `begins_with(SK, 'TIMESTAMP#')`). */
export function auditTypePartitionKey(metadataTypeCode: string): string {
  return `AUDIT#METADATA_TYPE#${metadataTypeCode}`;
}

/** Audit partition PK for metadata value changes. */
export function auditValuePartitionKey(valueCode: string): string {
  return `AUDIT#METADATA_VALUE#${valueCode}`;
}

/** @deprecated Use auditTypePartitionKey — same string, used as SK prefix in legacy audit rows. */
export function auditTypePrefix(metadataTypeCode: string): string {
  return auditTypePartitionKey(metadataTypeCode);
}

/** @deprecated Use auditValuePartitionKey */
export function auditValuePrefix(valueCode: string): string {
  return auditValuePartitionKey(valueCode);
}

/**
 * Builds APPL sort keys for all combinations of applicability dimensions.
 * Uses `*` when a dimension is empty (matches "any" for that segment in the key).
 */
export function buildApplSortKeys(valueCode: string, applicability: import('./types').Applicability): string[] {
  const modules = applicability.module.length ? applicability.module : [APPL_WILDCARD];
  const categories = applicability.category.length ? applicability.category : [APPL_WILDCARD];
  const conditions = applicability.condition.length ? applicability.condition : [APPL_WILDCARD];
  const countries = applicability.country.length ? applicability.country : [APPL_WILDCARD];
  const langs = applicability.language?.length ? applicability.language : [APPL_WILDCARD];

  const keys: string[] = [];
  for (const m of modules) {
    for (const c of categories) {
      for (const co of conditions) {
        for (const country of countries) {
          for (const lang of langs) {
            keys.push(`APPL#${m}#${c}#${co}#${country}#${lang}#VALUE#${valueCode}`);
          }
        }
      }
    }
  }
  return [...new Set(keys)];
}

export function extractValueCodeFromApplSk(sk: string): string | null {
  const parts = sk.split('#');
  const vIdx = parts.indexOf('VALUE');
  if (vIdx >= 0 && vIdx < parts.length - 1) {
    return parts[parts.length - 1] ?? null;
  }
  return parts[parts.length - 1] ?? null;
}
