import type {
  MetadataRegistryTypeValuesDto,
  MetadataRegistryValueDto,
} from '@api-hub/service-clients';

import { METADATA_STATUS } from '@api-hub/utils';
import { TemplateField } from '../utils/template-ui-response';

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
  items: TemplateField[];
  missingMetadataTypeCodes: string[];
}

function mapValue(value: MetadataRegistryValueDto): TemplateConfigMetaValue | null {
  if (value.status !== METADATA_STATUS.ACTIVE) {
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

const validationBuilder = (item:any) => {
  if(item.required){
    return {
      required: {
        value: item.required,
        messageKey: `${item.metadataType}.validation.required`,
      },
    };
  }
  return {};
};

function mapTypeValue(item: MetadataRegistryTypeValuesDto): TemplateField {
  
  return {
    code: item.metadataType,
    displayName: item.displayName,
    isGlobal: item.isGlobal ?? false,
    type: item.valueDataType === 'Enum' ? 'select' : 'text',
    labelKey: `${item.metadataType?.toLowerCase()}.label`,
    placeholderKey: `${item.metadataType?.toLowerCase()}.placeholder`,
    options: item.values
      .map((value) => ({
        labelKey: value.label,
        value: value.valueCode,
      })),
    validation: validationBuilder(item) as TemplateField['validation'],
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
  const activeItems = input.items.filter((item) => item.status?.toUpperCase()?.trim()!== METADATA_STATUS.INACTIVE);
  return {
    items: activeItems.map(mapTypeValue),
    missingMetadataTypeCodes: input.missingMetadataTypeCodes,
  };
}
