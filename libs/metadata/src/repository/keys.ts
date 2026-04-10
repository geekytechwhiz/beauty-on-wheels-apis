import { GSI1_PK_REGISTRY_TYPES } from '../domain/constants';
import type { RegistryStatus } from '../domain/types';

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

export function pkMetadataType(metadataTypeCode: string): string {
  return `METADATA_TYPE#${metadataTypeCode}`;
}

export function skTypeMetadata(): string {
  return 'TYPE#METADATA';
}

export function skValue(metadataValueCode: string): string {
  return `VALUE#${metadataValueCode}`;
}

export function skAppl(
  module: string,
  category: string,
  condition: string,
  country: string,
  metadataValueCode: string,
): string {
  return `APPL#${module}#${category}#${condition}#${country}#VALUE#${metadataValueCode}`;
}

export function gsi1pkRegistryTypes(): string {
  return GSI1_PK_REGISTRY_TYPES;
}

export function gsi1skMetadataType(metadataTypeCode: string): string {
  return `METADATA_TYPE#${metadataTypeCode}`;
}

export function gsi1pkTypeValues(metadataTypeCode: string): string {
  return `TYPE_VALUES#${metadataTypeCode}`;
}

export function gsi1skMetadataValue(status: RegistryStatus, metadataValueCode: string): string {
  return `${status}#VALUE#${metadataValueCode}`;
}

export function gsi2skMetadataType(metadataTypeCode: string): string {
  return metadataTypeCode;
}

export function gsi2skMetadataValue(metadataTypeCode: string, metadataValueCode: string): string {
  return `${metadataTypeCode}#${metadataValueCode}`;
}

export function gsi2skAppl(metadataTypeCode: string, metadataValueCode: string): string {
  return `${metadataTypeCode}#${metadataValueCode}`;
}
