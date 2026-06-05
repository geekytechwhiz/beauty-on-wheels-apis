import type { MetadataTypeSeedDefinition } from '../../interfaces';

const enumType = (
  code: string,
  displayName: string,
  multiSelect: boolean,
  opts?: Partial<MetadataTypeSeedDefinition>,
): MetadataTypeSeedDefinition => ({
  metadataTypeCode: code,
  displayName,
  valueDataType: 'Enum',
  multiSelectAllowed: multiSelect,
  status: 'ACTIVE',
  ...opts,
});

export const FOUNDATIONAL_TYPE_DEFINITIONS: MetadataTypeSeedDefinition[] = [
  enumType('ApplicableModule', 'Applicable Module', false, {
    description: 'Platform modules/services where metadata may apply',
    applicableModules: [],
  }),
  enumType('Category', 'Category', true, {
    description: 'Clinical and wellness categories',
    valueApplicabilityConfig: { categoryDependent: false },
  }),
  enumType('Condition', 'Condition', true, {
    description: 'Clinical conditions aligned to categories',
    relation: {
      supportsRelations: true,
      relationType: 'BELONGS_TO_CATEGORY',
      targetMetadataTypeCode: 'Category',
      relationFieldLabel: 'Category',
      selectionMode: 'SINGLE',
      relationRequired: true,
    },
  }),
  enumType('Country', 'Country', true, {
    description: 'Global and platform-supported countries',
  }),
  enumType('Language', 'Language', true, {
    description: 'Platform-supported languages',
  }),
  enumType('Specialty', 'Specialty', true, {
    description: 'Clinical specialties',
  }),
];
