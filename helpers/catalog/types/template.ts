import type { MetadataTypeSeedDefinition } from '../../interfaces';

const enumType = (
  code: string,
  displayName: string,
  multiSelect: boolean,
  applicableModules?: string[],
): MetadataTypeSeedDefinition => ({
  metadataTypeCode: code,
  displayName,
  valueDataType: 'Enum',
  multiSelectAllowed: multiSelect,
  status: 'ACTIVE',
  ...(applicableModules ? { applicableModules } : {}),
});

export const TEMPLATE_TYPE_DEFINITIONS: MetadataTypeSeedDefinition[] = [
  enumType('TemplateStatus', 'Template Status', false),
  enumType('ShareScope', 'Share Scope', false),
  enumType('ControlAction', 'Control Action', false),
  enumType('MetadataMode', 'Metadata Mode', false),
  enumType('DurationType', 'Duration Type', true, ['CARE_PLAN', 'OKR']),
  {
    metadataTypeCode: 'Device',
    displayName: 'Device',
    valueDataType: 'Enum',
    multiSelectAllowed: true,
    applicableModules: ['CARE_PLAN', 'THRESHOLD'],
    status: 'ACTIVE',
    relation: {
      supportsRelations: true,
      relationType: 'SUPPORTED_BY',
      targetMetadataTypeCode: 'Vital',
      relationFieldLabel: 'Vital',
      selectionMode: 'SINGLE',
      relationRequired: false,
    },
  },
  enumType('DataSourceType', 'Data Source Type', true, ['CARE_PLAN', 'OKR', 'THRESHOLD']),
  enumType('ReviewStatus', 'Review Status', true, ['CARE_PLAN', 'OKR']),
  enumType('Vital', 'Vital', true),
];
