import { APPL_WILDCARD, TYPE_INDEX_PK, TYPE_INDEX_SK_PREFIX } from '../constants';
import type { Applicability } from '../models/types';

/**
 * Static construction of DynamoDB PK/SK strings for the metadata registry.
 * Preserve literal formats exactly — refactoring only extraction, not semantics.
 */
export class MetadataKeyBuilder {
  /** Sort key prefix for listing latest pointers per value. */
  static valueLatestSortKeyPrefix(): string {
    return 'VALUE_LATEST#';
  }

  /** Sort key prefix for applicability projection rows. */
  static applSortKeyPrefix(): string {
    return 'APPL#';
  }

  /** Sort key prefix for audit event chronology queries (`begins_with`). */
  static auditTimestampSortKeyPrefix(): string {
    return 'TIMESTAMP#';
  }

  static typePartitionKey(metadataTypeCode: string): string {
    return `METADATA_TYPE#${metadataTypeCode}`;
  }

  static catalogSortKey(metadataTypeCode: string): string {
    return `${TYPE_INDEX_SK_PREFIX}${metadataTypeCode}`;
  }

  static catalogPartitionKey(): string {
    return TYPE_INDEX_PK;
  }

  static typeEntitySk(version: number): string {
    return `TYPE#METADATA#v${version}`;
  }

  static readonly LEGACY_TYPE_ENTITY_SK_V1 = 'TYPE#METADATA' as const;

  static schemaSk(version: number): string {
    return `SCHEMA#v${version}`;
  }

  static typeLatestPointerSk(): string {
    return 'TYPE_LATEST#METADATA';
  }

  static valueSk(valueCode: string, version: number): string {
    return `VALUE#${valueCode}#v${version}`;
  }

  static valueLatestSk(valueCode: string): string {
    return `VALUE_LATEST#${valueCode}`;
  }

  static auditTypePartitionKey(metadataTypeCode: string): string {
    return `AUDIT#METADATA_TYPE#${metadataTypeCode}`;
  }

  static auditValuePartitionKey(valueCode: string): string {
    return `AUDIT#METADATA_VALUE#${valueCode}`;
  }

  static auditTypePrefix(metadataTypeCode: string): string {
    return MetadataKeyBuilder.auditTypePartitionKey(metadataTypeCode);
  }

  static auditValuePrefix(valueCode: string): string {
    return MetadataKeyBuilder.auditValuePartitionKey(valueCode);
  }

  /** Legacy audit rows keyed under the type PK with SK `${AUDIT_PK}#`. */
  static legacyTypeAuditSkPrefixOnTypePartition(metadataTypeCode: string): string {
    return `${MetadataKeyBuilder.auditTypePrefix(metadataTypeCode)}#`;
  }

  /** Legacy audit rows keyed under the type PK with SK `${AUDIT_VALUE_PK}#`. */
  static legacyValueAuditSkPrefixOnTypePartition(valueCode: string): string {
    return `${MetadataKeyBuilder.auditValuePrefix(valueCode)}#`;
  }

  static applSortSegment(
    module: string,
    category: string,
    condition: string,
    country: string,
    lang: string,
    valueCode: string,
  ): string {
    return `APPL#${module}#${category}#${condition}#${country}#${lang}#VALUE#${valueCode}`;
  }

  static buildApplSortKeys(valueCode: string, applicability: Applicability): string[] {
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
              keys.push(MetadataKeyBuilder.applSortSegment(m, c, co, country, lang, valueCode));
            }
          }
        }
      }
    }
    return [...new Set(keys)];
  }

  static extractValueCodeFromApplSk(sk: string): string | null {
    const parts = sk.split('#');
    const vIdx = parts.indexOf('VALUE');
    if (vIdx >= 0 && vIdx < parts.length - 1) {
      return parts[parts.length - 1] ?? null;
    }
    return parts[parts.length - 1] ?? null;
  }

  static catalogTypeEntrySortKeyPrefix(): string {
    return 'TYPE#';
  }

  /** Prefix for query: captures legacy SK `TYPE#METADATA` and versioned `TYPE#METADATA#vN`. */
  static typeMetadataFamilySortKeyPrefix(): string {
    return 'TYPE#METADATA';
  }

  /** Prefix for immutable type SK rows excluding legacy v1 shorthand. */
  static typeMetadataVersionedSkPrefix(): string {
    return 'TYPE#METADATA#';
  }

  static auditTimestampSk(timestampIso: string, ulidSuffix: string): string {
    return `TIMESTAMP#${timestampIso}#${ulidSuffix}`;
  }

  static changeRequestPartitionKey(changeRequestId: string): string {
    return `CHANGE_REQUEST#${changeRequestId}`;
  }

  static changeRequestMetaSortKey(): string {
    return 'META';
  }

  /** One active draft pointer per type or value under the metadata type partition. */
  static changeRequestDraftPointerSortKey(entityType: 'type' | 'value', metadataValueCode?: string): string {
    if (entityType === 'type') {
      return 'CHANGE_REQUEST#DRAFT#TYPE';
    }
    const code = String(metadataValueCode ?? '').trim();
    return `CHANGE_REQUEST#DRAFT#VALUE#${code}`;
  }
}
