/** Metadata value lifecycle status returned by metadata-registry (only ACTIVE options are exposed). */
export const METADATA_VALUE_STATUS_ACTIVE = 'ACTIVE' as const;

/** Default metadata types for template-config UI dropdowns (plan overview fields). */
export const DEFAULT_TEMPLATE_CONFIG_METADATA_TYPE_CODES = [
  'Country',
  'Language',
  'Conditions',
  'SPECIALITY',
] as const;
