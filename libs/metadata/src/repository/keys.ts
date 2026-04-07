import { GSI1_PK_REGISTRY_TYPES } from '../domain/constants';

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
