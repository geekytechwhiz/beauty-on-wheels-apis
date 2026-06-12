import type { OrganizationConfigData } from '../models';

/** Maps org config fields to Metadata Registry type codes (labels resolved at read time). */
export const CONFIG_FIELD_TO_METADATA_TYPE = {
  countryCode: 'Country',
  stateCode: 'State',
  cityCode: 'City',
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

export const ENRICHABLE_CONFIG_SINGLE_FIELDS: readonly EnrichableConfigField[] = [
  'countryCode',
  'stateCode',
  'cityCode',
  'defaultLanguageCode',
  'currencyCode',
];

export const ENRICHABLE_CONFIG_ARRAY_FIELDS: readonly EnrichableConfigField[] = [
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
];
