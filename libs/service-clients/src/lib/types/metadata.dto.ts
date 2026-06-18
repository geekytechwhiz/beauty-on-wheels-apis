/** Upstream metadata registry value row (POST `/metadata/values/by-types`). */
export interface MetadataRegistryValueDto {
  valueCode: string;
  label: string;
  status: string;
  isGlobal: boolean;
  sortOrder: number;
  attributes: Record<string, unknown>;
  applicability: {
    module: string[];
    category: string[];
    condition: string[];
    country: string[];
    language: string[];
  };
}

/** One metadata type plus active values from the registry batch read API. */
export interface MetadataRegistryTypeValuesDto {
  metadataType: string;
  
  displayName: string;
  multiSelectAllowed: boolean;
  required: boolean;
  valueDataType: string;
  isGlobal: boolean;
  sortOrder: number;
  attributes: Record<string, unknown>;
  applicability: {
    module: string[];
    category: string[];
    condition: string[];
    country: string[];
    language: string[];
  };

  values: MetadataRegistryValueDto[];
}

/** Payload for POST `/metadata/values/by-types`. */
export interface MetadataValuesByTypesRequestDto {
  metadataTypeCodes: string[];
}

/** Unwrapped `data` from POST `/metadata/values/by-types`. */
export interface MetadataValuesByTypesResultDto {
  items: MetadataRegistryTypeValuesDto[];
  missingMetadataTypeCodes: string[];
}

/** Related value ref from GET `/metadata/values/related`. */
export interface MetadataRegistryRelatedValueDto {
  metadataTypeCode: string;
  metadataValueCode: string;
  label?: string;
}

/** One source value and its related targets from GET `/metadata/values/related`. */
export interface MetadataRegistryRelatedValuesGroupDto {
  fromMetadataTypeCode: string;
  fromMetadataValueCode: string;
  fromLabel?: string;
  values: MetadataRegistryRelatedValueDto[];
}

/** Unwrapped `data` from GET `/metadata/values/related`. */
export interface MetadataRelatedValuesResultDto {
  groups: MetadataRegistryRelatedValuesGroupDto[];
}
