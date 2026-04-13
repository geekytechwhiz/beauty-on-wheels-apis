/** Sentinel for "any" within a dimension — used for applicability filtering on METADATA_VALUE. */
export const GLOBAL_DIMENSION = 'GLOBAL' as const;

export const ENTITY_TYPE = {
  METADATA_TYPE: 'METADATA_TYPE',
  METADATA_VALUE: 'METADATA_VALUE',
} as const;

export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

/** GSI1: list all metadata types without scanning the main table. */
export const GSI1_PK_REGISTRY_TYPES = 'REGISTRY_TYPES';
