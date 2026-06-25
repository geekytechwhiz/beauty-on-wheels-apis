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

const validationBuilder = (item: MetadataRegistryTypeValuesDto) => {
  if (item.required) {
    return {
      required: {
        value: item.required,
        messageKey: `${item.metadataType}.validation.required`,
      },
    };
  }
  return {};
};

function isEnumValueDataType(valueDataType: string | undefined): boolean {
  return valueDataType?.trim().toUpperCase() === 'ENUM';
}

function toEnumOptions(values: MetadataRegistryValueDto[]): TemplateField['options'] {
  return values
    .filter((value) => value.status === METADATA_STATUS.ACTIVE)
    .map((value) => ({
      labelKey: value.label,
      value: value.valueCode,
      description: value.description ?? null,
    }));
}

function mapTypeValue(item: MetadataRegistryTypeValuesDto): TemplateField {
  const isEnumType = isEnumValueDataType(item.valueDataType);

  return {
    code: item.metadataType,
    displayName: item.displayName,
    isGlobal: item.isGlobal ?? false,
    type: item.valueDataType,
    labelKey: `${item.metadataType?.toLowerCase()}.label`,
    placeholderKey: `${item.metadataType?.toLowerCase()}.placeholder`,
    options: isEnumType ? toEnumOptions(item.values) : [],
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
  const activeItems = input.items.filter(
    (item) => item.status?.toUpperCase()?.trim() !== METADATA_STATUS.INACTIVE,
  );
  return {
    items: activeItems.map(mapTypeValue),
    missingMetadataTypeCodes: input.missingMetadataTypeCodes,
  };
}
