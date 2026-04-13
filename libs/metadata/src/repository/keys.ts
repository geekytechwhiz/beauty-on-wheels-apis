import { GSI1_PK_REGISTRY_TYPES } from '../domain/constants';

/** sk1 = status */
export const LSI_STATUS = 'pk-sk1-index';
/** sk2 = createdAt */
export const LSI_CREATED_AT = 'pk-sk2-index';
/** sk3 = lastModifiedAt */
export const LSI_UPDATED_AT = 'pk-sk3-index';
/** sk4 = metadataValueCode */
export const LSI_VALUE_CODE = 'pk-sk4-index';
/** sk5 = entityType */
export const LSI_ENTITY_TYPE = 'pk-sk5-index';

/** VALUE# prefix for base-table SK range queries on metadata values. */
export const VALUE_SK_PREFIX = 'VALUE#';

export function pkMetadataType(metadataTypeCode: string): string {
  return `METADATA_TYPE#${metadataTypeCode}`;
}

export function skTypeMetadata(): string {
  return 'TYPE#METADATA';
}

export function skValue(metadataValueCode: string): string {
  return `VALUE#${metadataValueCode}`;
}

export function gsi1pkRegistryTypes(): string {
  return GSI1_PK_REGISTRY_TYPES;
}

export function gsi1skMetadataType(metadataTypeCode: string): string {
  return `METADATA_TYPE#${metadataTypeCode}`;
}

