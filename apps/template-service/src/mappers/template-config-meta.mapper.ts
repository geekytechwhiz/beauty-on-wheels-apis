import type {
  MetadataRegistryTypeValuesDto,
  MetadataRegistryValueDto,
} from '@api-hub/service-clients';

import { METADATA_VALUE_STATUS_ACTIVE } from '../constants/template-config-meta.constants';

export interface TemplateConfigMetaValue {
  valueCode: string;
  label: string;
  isGlobal: boolean;
  applicability: MetadataRegistryValueDto['applicability'];
}

export interface TemplateConfigMetaTypeItem {
  metadataType: string;
  displayName: string;
  multiSelectAllowed: boolean;
  valueDataType: string;
  values: TemplateConfigMetaValue[];
}

export interface TemplateConfigMetaResponse {
  items: TemplateConfigMetaTypeItem[];
  missingMetadataTypeCodes: string[];
}

function mapValue(value: MetadataRegistryValueDto): TemplateConfigMetaValue | null {
  if (value.status !== METADATA_VALUE_STATUS_ACTIVE) {
    return null;
  }

  return {
    valueCode: value.valueCode,
    label: value.label,
    isGlobal: value.isGlobal,
    applicability: value.applicability,
  };
}

function mapTypeItem(item: MetadataRegistryTypeValuesDto): TemplateConfigMetaTypeItem {
  return {
    metadataType: item.metadataType,
    displayName: item.displayName,
    multiSelectAllowed: item.multiSelectAllowed,
    valueDataType: item.valueDataType,
    values: item.values
      .map(mapValue)
      .filter((value): value is TemplateConfigMetaValue => value !== null),
  };
}

/**
 * Maps metadata-registry batch read output into template-config meta response.
 * Matches upstream shape; omits `status`, `sortOrder`, and `attributes` from each value.
 */
export function mapTemplateConfigMetaResponse(input: {
  items: MetadataRegistryTypeValuesDto[];
  missingMetadataTypeCodes: string[];
}): TemplateConfigMetaResponse {
  return {
    items: input.items.map(mapTypeItem),
    missingMetadataTypeCodes: input.missingMetadataTypeCodes,
  };
}
