import type { OrganizationConfigData } from '../models';

/** Maps org config fields to Metadata Registry type codes (labels resolved at read time). */
export const CONFIG_FIELD_TO_METADATA_TYPE = {
  enabledCountryCodes: 'Country',
  enabledStateCodes: 'State',
  enabledCityCodes: 'City',
  defaultLanguageCode: 'Language',
  supportedLanguageCodes: 'Language',
  enabledCategoryCodes: 'Category',
  enabledConditionCodes: 'Condition',
  enabledSpecialtyCodes: 'Specialty',
  enabledDeviceCodes: 'Device',
  enabledVitalCodes: 'Vital',
  enabledMetricCodes: 'MetricCode',
  enabledReminderChannels: 'ReminderChannel',
  enabledRoleTypes: 'RoleType',
  requiredDocumentTypes: 'DocumentType',
  requiredAgreementTypes: 'AgreementType',
  currencyCode: 'Currency',
  paymentModeCodes: 'PaymentMode',
  enabledModuleCodes: 'ApplicableModule',
  enabledFeatureCodes: 'Feature',
} as const satisfies Partial<Record<keyof OrganizationConfigData, string>>;

export type EnrichableConfigField = keyof typeof CONFIG_FIELD_TO_METADATA_TYPE;

export const ENRICHABLE_CONFIG_SINGLE_FIELDS = [
  'defaultLanguageCode',
  'currencyCode',
] as const satisfies readonly EnrichableConfigField[];

export type EnrichableConfigSingleField = (typeof ENRICHABLE_CONFIG_SINGLE_FIELDS)[number];

export const ENRICHABLE_CONFIG_ARRAY_FIELDS = [
  'enabledCountryCodes',
  'enabledStateCodes',
  'enabledCityCodes',
  'supportedLanguageCodes',
  'enabledCategoryCodes',
  'enabledConditionCodes',
  'enabledSpecialtyCodes',
  'enabledDeviceCodes',
  'enabledVitalCodes',
  'enabledMetricCodes',
  'enabledReminderChannels',
  'enabledRoleTypes',
  'requiredDocumentTypes',
  'requiredAgreementTypes',
  'paymentModeCodes',
  'enabledModuleCodes',
  'enabledFeatureCodes',
] as const satisfies readonly EnrichableConfigField[];

export type EnrichableConfigArrayField = (typeof ENRICHABLE_CONFIG_ARRAY_FIELDS)[number];

/** MetadataTypeCode -> organizationConfig field names (GET `?view=config` only). */
export function buildOrgConfigMetadataTypeMapping(): Record<string, string[]> {
  const mapping = new Map<string, string[]>();
  for (const field of [...ENRICHABLE_CONFIG_SINGLE_FIELDS, ...ENRICHABLE_CONFIG_ARRAY_FIELDS]) {
    const metadataType = CONFIG_FIELD_TO_METADATA_TYPE[field];
    const fields = mapping.get(metadataType) ?? [];
    fields.push(field);
    mapping.set(metadataType, fields);
  }
  return Object.fromEntries(mapping);
}

export const ORG_CONFIG_METADATA_TYPE_MAPPING = buildOrgConfigMetadataTypeMapping();
