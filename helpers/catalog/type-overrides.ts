import type { MetadataTypeSeedDefinition } from '../interfaces';
import { COMPLEX_TYPE_DEFINITIONS } from './types/complex';
import { FOUNDATIONAL_TYPE_DEFINITIONS } from './types/foundational';
import { GEOGRAPHY_TYPE_DEFINITIONS } from './types/geography';
import { MODULE_SCOPED_TYPE_DEFINITIONS } from './types/module-scoped';
import { TEMPLATE_TYPE_DEFINITIONS } from './types/template';

/** Governed type-level config (relations, schemas, applicability rules) not present in Excel. */
const ALL_TYPE_OVERRIDES: MetadataTypeSeedDefinition[] = [
  ...FOUNDATIONAL_TYPE_DEFINITIONS,
  ...GEOGRAPHY_TYPE_DEFINITIONS,
  ...TEMPLATE_TYPE_DEFINITIONS,
  ...MODULE_SCOPED_TYPE_DEFINITIONS,
  ...COMPLEX_TYPE_DEFINITIONS,
  // Excel-only types that need explicit relation / module config
  {
    metadataTypeCode: 'TemplateType',
    displayName: 'Template Type',
    valueDataType: 'Enum',
    multiSelectAllowed: true,
    applicableModules: ['TEMPLATE'],
    status: 'ACTIVE',
    valueApplicabilityConfig: { moduleScoped: true },
  },
  {
    metadataTypeCode: 'PackageType',
    displayName: 'Package Type',
    valueDataType: 'Enum',
    multiSelectAllowed: true,
    applicableModules: ['PACKAGE', 'PAYMENT'],
    status: 'ACTIVE',
    valueApplicabilityConfig: { moduleScoped: true },
  },
  {
    metadataTypeCode: 'ServiceType',
    displayName: 'Service Type',
    valueDataType: 'Enum',
    multiSelectAllowed: true,
    applicableModules: ['SERVICE', 'PACKAGE', 'APPOINTMENT'],
    status: 'ACTIVE',
    valueApplicabilityConfig: { moduleScoped: true },
    relation: {
      supportsRelations: true,
      relationType: 'ALLOWED_FOR',
      targetMetadataTypeCode: 'Specialty',
      relationFieldLabel: 'Allowed Specialties',
      selectionMode: 'MULTI',
      relationRequired: false,
    },
  },
];

export const METADATA_TYPE_OVERRIDE_BY_CODE = new Map<string, MetadataTypeSeedDefinition>(
  ALL_TYPE_OVERRIDES.map((def) => [def.metadataTypeCode, def]),
);

export function humanizeMetadataTypeCode(code: string): string {
  return code
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

export function defaultMetadataTypeDefinition(metadataTypeCode: string): MetadataTypeSeedDefinition {
  return {
    metadataTypeCode,
    displayName: humanizeMetadataTypeCode(metadataTypeCode),
    valueDataType: 'Enum',
    multiSelectAllowed: metadataTypeCode !== 'ApplicableModule',
    status: 'ACTIVE',
  };
}

export function resolveMetadataTypeDefinition(metadataTypeCode: string): MetadataTypeSeedDefinition {
  return METADATA_TYPE_OVERRIDE_BY_CODE.get(metadataTypeCode) ?? defaultMetadataTypeDefinition(metadataTypeCode);
}
