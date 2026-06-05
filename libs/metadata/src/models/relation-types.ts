/**
 * Public API + persistence enum for metadata value links (Country → State, Category → Condition under
 * `BELONGS_TO_CATEGORY`, Device → Vital, etc.).
 * Maps to `SK` prefix in {@link skPrefixForRelationType} in relation-keys.
 */
export const RELATION_TYPES = [
  'PARENT_CHILD',
  'VALID_IN',
  'SUPPORTED_BY',
  'BELONGS_TO_CATEGORY',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export const RELATION_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type RelationStatus = (typeof RELATION_STATUS)[keyof typeof RELATION_STATUS];

export const RELATION_ENTITY_TYPE = 'METADATA_RELATION' as const;

export interface MetadataRelationRecord {
  id: string;
  relationType: RelationType;
  fromMetadataTypeCode: string;
  fromMetadataValueCode: string;
  toMetadataTypeCode: string;
  toMetadataValueCode: string;
  status: RelationStatus;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface CreateMetadataRelationInput {
  relationType: RelationType;
  fromMetadataTypeCode: string;
  fromMetadataValueCode: string;
  toMetadataTypeCode: string;
  toMetadataValueCode: string;
  createdBy?: string;
}

/** Minimal shape for "related value" list responses. */
export interface RelatedValueRef {
  metadataTypeCode: string;
  metadataValueCode: string;
}
