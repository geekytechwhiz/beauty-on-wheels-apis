import type { MetadataTypeSeedDefinition } from '../../interfaces';

const enumType = (
  code: string,
  displayName: string,
  multiSelect: boolean,
  relation?: MetadataTypeSeedDefinition['relation'],
): MetadataTypeSeedDefinition => ({
  metadataTypeCode: code,
  displayName,
  valueDataType: 'Enum',
  multiSelectAllowed: multiSelect,
  status: 'ACTIVE',
  relation,
});

export const GEOGRAPHY_TYPE_DEFINITIONS: MetadataTypeSeedDefinition[] = [
  enumType('State', 'State / Province', true, {
    supportsRelations: true,
    relationType: 'PARENT_CHILD',
    targetMetadataTypeCode: 'Country',
    relationFieldLabel: 'Country',
    selectionMode: 'SINGLE',
    relationRequired: true,
  }),
  enumType('City', 'City', true, {
    supportsRelations: true,
    relationType: 'PARENT_CHILD',
    targetMetadataTypeCode: 'State',
    relationFieldLabel: 'State',
    selectionMode: 'SINGLE',
    relationRequired: true,
  }),
  enumType('CountryPhoneCode', 'Country Phone Code', true),
  enumType('Currency', 'Currency', false, {
    supportsRelations: true,
    relationType: 'VALID_IN',
    targetMetadataTypeCode: 'Country',
    relationFieldLabel: 'Country',
    selectionMode: 'MULTI',
    relationRequired: false,
  }),
];
