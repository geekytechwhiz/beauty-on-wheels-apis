import { z } from 'zod';
import { ORGANIZATION_CONFIG_DATA_KEYS } from '../models/Organization';

const supportedVitalsSchema = z
  .array(z.string())
  .or(z.array(z.record(z.string(), z.unknown())))
  .optional();

const integrationSchema = z
  .object({
    provider: z.string().optional(),
    providerName: z.string().optional(),
    sourceSystem: z.enum(['HMS', 'FHIR', 'CUSTOM', 'MARKETPLACE']).optional(),
    externalHospitalId: z.string().optional(),
    apiBaseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    apiKeyRef: z.string().optional(),
    subdomain: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

const configCodeSchema = z.string().min(1).transform((val) => val.trim());

const organizationConfigSchema = z
  .object({
    supportedCountries: z.array(configCodeSchema).optional(),
    supportedLanguages: z.array(configCodeSchema).optional(),
    supportedStates: z.array(configCodeSchema).optional(),
    supportedCategories: z.array(configCodeSchema).optional(),
    supportedConditions: z.array(configCodeSchema).optional(),
  })
  .refine(
    (value) =>
      value.supportedCountries !== undefined ||
      value.supportedLanguages !== undefined ||
      value.supportedStates !== undefined ||
      value.supportedCategories !== undefined ||
      value.supportedConditions !== undefined,
    {
      message: 'organizationConfig must include at least one supported* field',
    },
  )
  .optional();

export const createOrganizationSchema = z
  .object({
  organizationId: z.string().optional(),
  parentOrgId: z.string().optional(),
  createdAt: z.number().optional(),
  createdBy: z.string().optional(),
  modifiedBy: z.string().optional(),
  traceId: z.string().optional(),
  name: z.string().min(1).max(255),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  phoneCode: z.string().optional(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  countryCode: z.string().optional(),
  postalCode: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']).optional().default('PENDING'),
  lsi_createdAt: z.number().optional(),
  lsi_entityType: z.string().optional(),
  lsi_organizationType: z.string().optional(),
  lsi_status: z.string().optional(),
  organizationType: z.string().optional(),
  organizationSize: z.string().optional(),
  noOfBranches: z.string().optional(),
  hospitalImage: z.string().optional(),
  googleMapsLink: z.string().optional(),
  hospitalBio: z.string().optional(),
  licenseNumber: z.string().optional(),
  scheduleConf: z.unknown().optional(),
  defaultSetting: z.unknown().optional(),
  goals: z.unknown().optional(),
  thresholds: z.unknown().optional(),
  workingHours: z.unknown().optional(),
  specialization: z.unknown().optional(),
  certifications: z.unknown().optional(),
  servicesOffered: z.unknown().optional(),
  appointmentType: z.unknown().optional(),
  facilityType: z.unknown().optional(),
  equipmentAvailable: z.unknown().optional(),
  emergencySupport: z.unknown().optional(),
  industryType: z.unknown().optional(),
  wellnessPrograms: z.unknown().optional(),
  onsiteFacilities: z.unknown().optional(),
  employeeCoverage: z.unknown().optional(),
  insurancePartnerships: z.boolean().optional(),
  remoteWellnessSupport: z.boolean().optional(),
  corporateDiscounts: z.boolean().optional(),
  adminDetails: z.unknown().optional(),
  modules: z.unknown().optional(),
  devices: z.unknown().optional(),
  supportedVitals: supportedVitalsSchema,
  organizationInfo: z.unknown().optional(),
  searchFields: z.unknown().optional(),
  website: z.string().optional(),
  taxId: z.string().optional(),
  registrationNumber: z.string().optional(),
  description: z.string().optional(),
  industry: z.string().optional(),
  size: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional(),
  integration: integrationSchema,
  subdomain: z.string().optional(),
  organizationConfig: organizationConfigSchema,
})
.superRefine((data, ctx) => {
  const organizationType = data.organizationType?.toUpperCase();
  if (organizationType !== 'HMS') return;

  if (!data.website?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['website'],
      message: 'website is required when organizationType is HMS',
    });
  }

  if (!data.integration?.apiBaseUrl?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['integration', 'apiBaseUrl'],
      message: 'integration.apiBaseUrl is required when organizationType is HMS',
    });
  }

  if (!data.integration?.apiKey?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['integration', 'apiKey'],
      message: 'integration.apiKey is required when organizationType is HMS',
    });
  }
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentOrgId: z.string().optional(),
  createdAt: z.number().optional(),
  createdBy: z.string().optional(),
  modifiedBy: z.string().optional(),
  traceId: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  phoneCode: z.string().optional(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  countryCode: z.string().optional(),
  postalCode: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING']).optional(),
  lsi_createdAt: z.number().optional(),
  lsi_entityType: z.string().optional(),
  lsi_organizationType: z.string().optional(),
  lsi_status: z.string().optional(),
  organizationType: z.string().optional(),
  organizationSize: z.string().optional(),
  noOfBranches: z.string().optional(),
  hospitalImage: z.string().optional(),
  googleMapsLink: z.string().optional(),
  hospitalBio: z.string().optional(),
  licenseNumber: z.string().optional(),
  scheduleConf: z.unknown().optional(),
  defaultSetting: z.unknown().optional(),
  goals: z.unknown().optional(),
  thresholds: z.unknown().optional(),
  workingHours: z.unknown().optional(),
  specialization: z.unknown().optional(),
  certifications: z.unknown().optional(),
  servicesOffered: z.unknown().optional(),
  appointmentType: z.unknown().optional(),
  facilityType: z.unknown().optional(),
  equipmentAvailable: z.unknown().optional(),
  emergencySupport: z.unknown().optional(),
  industryType: z.unknown().optional(),
  wellnessPrograms: z.unknown().optional(),
  onsiteFacilities: z.unknown().optional(),
  employeeCoverage: z.unknown().optional(),
  insurancePartnerships: z.boolean().optional(),
  remoteWellnessSupport: z.boolean().optional(),
  corporateDiscounts: z.boolean().optional(),
  adminDetails: z.unknown().optional(),
  modules: z.unknown().optional(),
  devices: z.unknown().optional(),
  supportedVitals: supportedVitalsSchema,
  organizationInfo: z.unknown().optional(),
  searchFields: z.unknown().optional(),
  website: z.string().optional(),
  taxId: z.string().optional(),
  registrationNumber: z.string().optional(),
  description: z.string().optional(),
  industry: z.string().optional(),
  size: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional(),
  integration: integrationSchema,
  subdomain: z.string().optional(),
  organizationConfig: organizationConfigSchema,
});

export const getExternalTenantSchema = z.object({
  provider: z.string().min(1, 'provider is required'),
  apiBaseUrl: z.string().url('apiBaseUrl must be a valid URL').optional(),
});

export const updateOrganizationMetadataSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).refine((obj) => Object.keys(obj).length > 0, {
    message: 'Metadata must be a non-empty object',
  }),
  updatedBy: z.string().optional(),
  version: z.number().int().nonnegative().optional(),
});

export const linkUnlinkOrganizationSchema = z.object({
  fromOrg: z.string().min(1, 'fromOrg is required'),
  toOrg: z.string().min(1, 'toOrg is required'),
  action: z.enum(['LINK', 'UNLINK'], { message: 'action must be LINK or UNLINK' }),
});

export const getLinkedOrganizationsSchema = z.object({
  organizationId: z.string().min(1, 'organizationId is required'),
  orgType: z.string().optional(),
  userId: z.string().optional(),
  preferredOrgId: z.string().optional(),
  limit: z.union([z.number().int().positive(), z.string().transform((s) => (s ? Number(s) : undefined))]).optional(),
  nextPaginationKey: z.string().optional(),
});

export const setOrgStatusSchema = z.object({
  organizationId: z.string().min(1, 'organizationId is required'),
  status: z.enum(['ACTIVE', 'HOLD', 'DISABLED'], { message: 'status must be ACTIVE, HOLD, or DISABLED' }),
});

/**
 * Body schema for `PUT /organization/{organizationId}/config`. Metadata codes only; no
 * Metadata Registry validation here (that happens on publish). Requires at least one
 * config field so empty drafts are rejected.
 */
export const updateOrganizationConfigSchema = z
  .object({
    enabledCountryCodes: z.array(configCodeSchema).optional(),
    enabledStateCodes: z.array(configCodeSchema).optional(),
    enabledCityCodes: z.array(configCodeSchema).optional(),
    timezone: z.string().min(1).optional(),
    defaultLanguageCode: configCodeSchema.optional(),
    supportedLanguageCodes: z.array(configCodeSchema).optional(),
    enabledCategoryCodes: z.array(configCodeSchema).optional(),
    enabledConditionCodes: z.array(configCodeSchema).optional(),
    enabledSpecialtyCodes: z.array(configCodeSchema).optional(),
    enabledDeviceCodes: z.array(configCodeSchema).optional(),
    enabledVitalCodes: z.array(configCodeSchema).optional(),
    enabledMetricCodes: z.array(configCodeSchema).optional(),
    enabledReminderChannels: z.array(configCodeSchema).optional(),
    enabledRoleTypes: z.array(configCodeSchema).optional(),
    requiredDocumentTypes: z.array(configCodeSchema).optional(),
    requiredAgreementTypes: z.array(configCodeSchema).optional(),
    currencyCode: configCodeSchema.optional(),
    paymentModeCodes: z.array(configCodeSchema).optional(),
    enabledModuleCodes: z.array(configCodeSchema).optional(),
    enabledFeatureCodes: z.array(configCodeSchema).optional(),
    linkedOrgReferences: z.array(configCodeSchema).optional(),
    requiredAgreementIds: z.array(configCodeSchema).optional(),
    changeReason: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (value) =>
      ORGANIZATION_CONFIG_DATA_KEYS.some(
        (key) => value[key as keyof typeof value] !== undefined,
      ),
    {
      message: 'organizationConfig must include at least one config field',
    },
  );

export type UpdateOrganizationConfigInput = z.infer<typeof updateOrganizationConfigSchema>;

export const publishOrganizationConfigSchema = z.object({
  changeReason: z.string().trim().min(1).max(500).optional(),
});

export type PublishOrganizationConfigInput = z.infer<typeof publishOrganizationConfigSchema>;

export const organizationListSchema = z.object({
  organizationId: z.string().optional(),
  organizationID: z.string().optional(),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  organizationType: z.union([z.string(), z.array(z.string())]).optional(),
  assignedPackagesName: z.union([z.string(), z.array(z.string())]).optional(),
  adminName: z.string().optional(),
  organizationName: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  limit: z
    .union([z.number().int().positive(), z.string().transform((value) => (value ? Number(value) : undefined))])
    .optional(),
  nextPaginationKey: z.string().optional(),
  lastEvaluatedKey: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});
