/** POST /metadata/values/by-types request body. */
export interface MetadataValuesByTypesRequestDto {
  metadataTypeCodes: string[];
}

export interface MetadataRegistryValueDto {
  valueCode: string;
  label: string;
  description?: string | null;
  status: string;
}

export interface MetadataRegistryTypeValuesDto {
  metadataType: string;
  values: MetadataRegistryValueDto[];
}

export interface MetadataValuesByTypesResultDto {
  items: MetadataRegistryTypeValuesDto[];
  missingMetadataTypeCodes: string[];
}

export interface TaskMetadataReader {
  getValuesByTypes(
    request: MetadataValuesByTypesRequestDto,
    authHeader: string,
  ): Promise<MetadataValuesByTypesResultDto>;
}
