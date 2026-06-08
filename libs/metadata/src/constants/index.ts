/**
 * Type index partition for listing all metadata types via `begins_with(SK, 'TYPE#')` Query (no GSI, no Scan).
 * Aligns with Meta DB access pattern: PK `METADATA_TYPES`, SK `TYPE#<metadataTypeCode>`.
 */
export const TYPE_INDEX_PK = 'METADATA_TYPES' as const;

/** @deprecated Use TYPE_INDEX_PK */
export const CATALOG_PK = TYPE_INDEX_PK;

/** SK prefix for catalog rows: `TYPE#<code>` */
export const TYPE_INDEX_SK_PREFIX = 'TYPE#' as const;

/** @deprecated Use TYPE_INDEX_SK_PREFIX */
export const CATALOG_SK_PREFIX = TYPE_INDEX_SK_PREFIX;

/** Pre-design-doc catalog partition; still queried for list migration. */
export const LEGACY_CATALOG_PK = 'METADATA_REGISTRY#CATALOG' as const;
export const LEGACY_CATALOG_SK_PREFIX = 'METADATA_TYPE#' as const;

export const ENTITY_TYPE = {
  METADATA_TYPE: 'METADATA_TYPE',
  METADATA_VALUE: 'METADATA_VALUE',
  CATALOG_ENTRY: 'CATALOG_ENTRY',
  CHANGE_REQUEST: 'CHANGE_REQUEST',
  CHANGE_REQUEST_DRAFT_POINTER: 'CHANGE_REQUEST_DRAFT_POINTER',
} as const;

/**
 * Only these metadata types use a separate `SCHEMA#vN` item (`PK = METADATA_TYPE#<code>`, `SK = SCHEMA#vN`).
 * All other types store no schema row; attributes live on value records only.
 */
export const METADATA_TYPES_WITH_ATTRIBUTE_SCHEMA = ['MetricCode', 'QuestionCode'] as const;

/** Metadata type whose value codes define allowed `questionType` on QuestionCode values. */
export const QUESTION_TYPE_METADATA_CODE = 'QuestionType' as const;

export function metadataTypeUsesSeparateSchemaItem(metadataTypeCode: string): boolean {
  return (METADATA_TYPES_WITH_ATTRIBUTE_SCHEMA as readonly string[]).includes(metadataTypeCode);
}

/**
 * Types that use `SCHEMA#vN` always persist a schema row: if the client omits `attributeSchema`, we default to `{}`
 * so DynamoDB still gets `PK/SK = …/SCHEMA#v1` with `version` + `attributeSchema` as in the access pattern.
 */
export function resolveAttributeSchemaForMetadataType(
  metadataTypeCode: string,
  attributeSchema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadataTypeUsesSeparateSchemaItem(metadataTypeCode)) {
    return attributeSchema;
  }
  return attributeSchema === undefined ? {} : attributeSchema;
}

export const STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DELETED: 'DELETED',
} as const;

/** Placeholder for optional applicability dimensions when building APPL SK rows. */
export const APPL_WILDCARD = '*' as const;
