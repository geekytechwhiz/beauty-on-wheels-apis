export type NormalizedOrganizationPayload = {
  organizationId?: string;
  parentOrgId?: string;
  createdAt?: number;
  createdBy?: string;
  modifiedBy?: string;
  traceId?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  website?: string;
  taxId?: string;
  registrationNumber?: string;
  description?: string;
  industry?: string;
  size?: 'SMALL' | 'MEDIUM' | 'LARGE';
  organizationType?: string;
  organizationSize?: string;
  noOfBranches?: string;
  phoneCode?: string;
  phoneNumber?: string;
  countryCode?: string;
  hospitalImage?: string;
  googleMapsLink?: string;
  hospitalBio?: string;
  licenseNumber?: string;
  scheduleConf?: unknown;
  defaultSetting?: unknown;
  goals?: unknown;
  thresholds?: unknown;
  workingHours?: unknown;
  specialization?: unknown;
  certifications?: unknown;
  servicesOffered?: unknown;
  appointmentType?: unknown;
  facilityType?: unknown;
  equipmentAvailable?: unknown;
  emergencySupport?: unknown;
  industryType?: unknown;
  wellnessPrograms?: unknown;
  onsiteFacilities?: unknown;
  employeeCoverage?: unknown;
  insurancePartnerships?: boolean;
  remoteWellnessSupport?: boolean;
  corporateDiscounts?: boolean;
  adminDetails?: unknown;
  modules?: unknown;
  devices?: unknown;
  supportedVitals?: unknown;
  organizationInfo?: Record<string, unknown>;
  searchFields?: Record<string, unknown>;
  integration?: {
    provider?: string;
    providerName?: string;
    sourceSystem?: 'HMS' | 'FHIR' | 'CUSTOM' | 'MARKETPLACE';
    externalHospitalId?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    apiKeyRef?: string;
    subdomain?: string;
    metadata?: Record<string, unknown>;
  };
  subdomain?: string;
  organizationConfig?: {
    supportedCountries?: string[];
    supportedLanguages?: string[];
    supportedStates?: string[];
    supportedCategories?: string[];
    supportedConditions?: string[];
  };
};
import { extractSubdomainFromUrl } from './helpers';

type NormalizationResult = {
  data: NormalizedOrganizationPayload;
  errors: Array<{ field: string; message: string }>;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const looksLikeEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const normalizeEmail = (value: unknown): string | undefined => {
  const normalized = normalizeString(value);
  if (!normalized || !looksLikeEmail(normalized)) {
    return undefined;
  }
  return normalized;
};

const buildPhone = (phoneCode?: unknown, phoneNumber?: unknown): string | undefined => {
  const code = normalizeString(phoneCode);
  const number = normalizeString(phoneNumber);
  if (!code && !number) return undefined;
  if (code && number) {
    return code.startsWith('+') ? `${code}${number}` : `+${code}${number}`;
  }
  return number;
};

type IntegrationSourceSystem = NonNullable<NormalizedOrganizationPayload['integration']>['sourceSystem'];

const parseIntegrationSourceSystem = (value: unknown): IntegrationSourceSystem | undefined => {
  const raw = normalizeString(value);
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  if (upper === 'HMS' || upper === 'FHIR' || upper === 'CUSTOM' || upper === 'MARKETPLACE') {
    return upper as IntegrationSourceSystem;
  }
  return undefined;
};

const normalizeCodeArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const normalizedValues = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0);

  return Array.from(new Set(normalizedValues));
};

export const normalizeOrganizationPayload = (input: any): NormalizationResult => {
  const errors: Array<{ field: string; message: string }> = [];
  const organizationInfo = input?.organizationInfo || {};
  const organizationConfigInput =
    input?.organizationConfig && typeof input.organizationConfig === 'object'
      ? input.organizationConfig
      : undefined;
  const orgAddress = organizationInfo?.organizationAdd || organizationInfo?.address || {};

  const organizationId =
    normalizeString(input?.accountAlias) ||
    normalizeString(input?.organizationId) ||
    normalizeString(input?.organizationID) ||
    normalizeString(organizationInfo?.orgId) ||
    normalizeString(organizationInfo?.organizationID);

  const parentOrgId =
    normalizeString(input?.parentOrgId) ||
    normalizeString(organizationInfo?.parentOrgId);

  const name =
    normalizeString(input?.name) ||
    normalizeString(organizationInfo?.organizationName) ||
    normalizeString(organizationInfo?.name);

  const email =
    normalizeEmail(input?.email) ||
    normalizeEmail(organizationInfo?.emailAddress);

  const phone =
    normalizeString(input?.phone) ||
    buildPhone(organizationInfo?.phoneCode, organizationInfo?.phoneNumber);
  const phoneCode =
    normalizeString(input?.phoneCode) ||
    normalizeString(organizationInfo?.phoneCode);
  const phoneNumber =
    normalizeString(input?.phoneNumber) ||
    normalizeString(organizationInfo?.phoneNumber);

  const address =
    normalizeString(input?.address) ||
    normalizeString(orgAddress?.address) ||
    normalizeString(orgAddress?.street);

  const city = normalizeString(input?.city) || normalizeString(orgAddress?.city);
  const state = normalizeString(input?.state) || normalizeString(orgAddress?.state);
  const country = normalizeString(input?.country) || normalizeString(orgAddress?.country);
  const countryCode = normalizeString(input?.countryCode) || normalizeString(orgAddress?.countryCode);
  const postalCode = normalizeString(input?.postalCode) || normalizeString(orgAddress?.postalCode);

  const website = normalizeString(input?.website) || normalizeString(organizationInfo?.website);
  const description = normalizeString(input?.description) || normalizeString(organizationInfo?.hospitalBio);
  const hospitalBio = normalizeString(organizationInfo?.hospitalBio);
  const organizationType =
    normalizeString(input?.organizationType) ||
    normalizeString(organizationInfo?.organizationType);
  const industry =
    normalizeString(input?.industry) || normalizeString(organizationInfo?.industryType);
  const industryType = organizationInfo?.industryType;
  const taxId = normalizeString(input?.taxId) || normalizeString(organizationInfo?.taxId);
  const registrationNumber =
    normalizeString(input?.registrationNumber) || normalizeString(organizationInfo?.licenseNumber);
  const licenseNumber = normalizeString(organizationInfo?.licenseNumber);
  const integrationInput =
    organizationInfo?.integration && typeof organizationInfo.integration === 'object'
      ? organizationInfo?.integration
      : undefined;
  const apiBaseUrl = normalizeString(integrationInput?.apiBaseUrl);
  const derivedSubdomain = extractSubdomainFromUrl(apiBaseUrl);
  const integrationSubdomain = normalizeString(integrationInput?.subdomain) || derivedSubdomain;
  const integration: NormalizedOrganizationPayload['integration'] =
    integrationInput || derivedSubdomain
      ? {
          provider: normalizeString(integrationInput?.provider),
          providerName: normalizeString(integrationInput?.providerName),
          sourceSystem: parseIntegrationSourceSystem(integrationInput?.sourceSystem),
          externalHospitalId: normalizeString(integrationInput?.externalHospitalId),
          apiBaseUrl,
          apiKey: normalizeString(integrationInput?.apiKey),
          apiKeyRef: normalizeString(integrationInput?.apiKeyRef),
          subdomain: integrationSubdomain,
          metadata:
            integrationInput?.metadata && typeof integrationInput.metadata === 'object'
              ? (integrationInput.metadata as Record<string, unknown>)
              : undefined,
        }
      : undefined;

  const organizationSizeRaw =
    normalizeString(input?.organizationSize) || normalizeString(organizationInfo?.organizationSize);
  const noOfBranchesRaw =
    normalizeString(input?.noOfBranches) || normalizeString(organizationInfo?.noOfBranches);
  const organizationSize =
    organizationInfo && Object.keys(organizationInfo).length > 0
      ? String(organizationSizeRaw ?? null)
      : organizationSizeRaw;
  const noOfBranches =
    organizationInfo && Object.keys(organizationInfo).length > 0
      ? String(noOfBranchesRaw ?? null)
      : noOfBranchesRaw;
  const hospitalImage = normalizeString(organizationInfo?.hospitalImage);
  const googleMapsLink = normalizeString(organizationInfo?.googleMapsLink);
  const scheduleConf = organizationInfo?.scheduleConf;
  const defaultSetting = organizationInfo?.defaultSetting;
  const goals = organizationInfo?.goals;
  const thresholds = organizationInfo?.thresholds;
  const workingHours = organizationInfo?.workingHours;
  const specialization = organizationInfo?.specialization;
  const certifications = organizationInfo?.certifications;
  const servicesOffered = organizationInfo?.servicesOffered;
  const appointmentType = organizationInfo?.appointmentType;
  const facilityType = organizationInfo?.facilityType;
  const equipmentAvailable = organizationInfo?.equipmentAvailable;
  const emergencySupport = organizationInfo?.emergencySupport;
  const wellnessPrograms = organizationInfo?.wellnessPrograms;
  const onsiteFacilities = organizationInfo?.onsiteFacilities;
  const employeeCoverage = organizationInfo?.employeeCoverage;
  const insurancePartnerships = organizationInfo?.insurancePartnerships;
  const remoteWellnessSupport = organizationInfo?.remoteWellnessSupport;
  const corporateDiscounts = organizationInfo?.corporateDiscounts;

  const adminDetailsInput = input?.adminDetails;
  const adminDetails = Array.isArray(adminDetailsInput)
    ? adminDetailsInput
    : adminDetailsInput && typeof adminDetailsInput === 'object'
      ? adminDetailsInput
      : undefined;

  const modules = input?.modules;
  const devices = input?.devices;
  const supportedVitals = input?.supportedVitals;

  let organizationConfig: NormalizedOrganizationPayload['organizationConfig'];
  if (organizationConfigInput) {
    const supportedCountries = normalizeCodeArray(organizationConfigInput.supportedCountries);
    const supportedLanguages = normalizeCodeArray(organizationConfigInput.supportedLanguages);
    const supportedStates = normalizeCodeArray(organizationConfigInput.supportedStates);
    const supportedCategories = normalizeCodeArray(organizationConfigInput.supportedCategories);
    const supportedConditions = normalizeCodeArray(organizationConfigInput.supportedConditions);

    if (
      organizationConfigInput.supportedCountries !== undefined &&
      !Array.isArray(organizationConfigInput.supportedCountries)
    ) {
      errors.push({ field: 'organizationConfig.supportedCountries', message: 'supportedCountries must be an array' });
    }
    if (
      organizationConfigInput.supportedLanguages !== undefined &&
      !Array.isArray(organizationConfigInput.supportedLanguages)
    ) {
      errors.push({ field: 'organizationConfig.supportedLanguages', message: 'supportedLanguages must be an array' });
    }
    if (organizationConfigInput.supportedStates !== undefined && !Array.isArray(organizationConfigInput.supportedStates)) {
      errors.push({ field: 'organizationConfig.supportedStates', message: 'supportedStates must be an array' });
    }
    if (
      organizationConfigInput.supportedCategories !== undefined &&
      !Array.isArray(organizationConfigInput.supportedCategories)
    ) {
      errors.push({ field: 'organizationConfig.supportedCategories', message: 'supportedCategories must be an array' });
    }
    if (
      organizationConfigInput.supportedConditions !== undefined &&
      !Array.isArray(organizationConfigInput.supportedConditions)
    ) {
      errors.push({ field: 'organizationConfig.supportedConditions', message: 'supportedConditions must be an array' });
    }

    organizationConfig = {
      ...(supportedCountries !== undefined ? { supportedCountries } : {}),
      ...(supportedLanguages !== undefined ? { supportedLanguages } : {}),
      ...(supportedStates !== undefined ? { supportedStates } : {}),
      ...(supportedCategories !== undefined ? { supportedCategories } : {}),
      ...(supportedConditions !== undefined ? { supportedConditions } : {}),
    };
  }

  const organizationInfoOutput = Object.keys(organizationInfo || {}).length > 0
    ? {
        organizationName: name,
        address: {
          city: city || '',
          country: country || '',
          countryCode: countryCode || '',
          address: address || '',
          postalCode: postalCode || '',
          state: state || '',
        },
        hospitalImage,
        website,
        organizationType,
        organizationSize,
        noOfBranches,
        hospitalBio,
        googleMapsLink,
        emailAddress: email,
        phoneCode,
        phoneNumber,
        specialization,
        certifications,
        servicesOffered,
        appointmentType,
        facilityType,
        equipmentAvailable,
        emergencySupport,
        industryType,
        wellnessPrograms,
        onsiteFacilities,
        employeeCoverage,
        insurancePartnerships,
        remoteWellnessSupport,
        corporateDiscounts,
        licenseNumber,
        scheduleConf,
        defaultSetting,
        goals,
        thresholds,
        workingHours,
      }
    : undefined;

  const searchFields =
    organizationInfoOutput
      ? {
          name: name?.toLowerCase(),
          city: city?.toLowerCase() || '',
          country: country?.toLowerCase() || '',
          countryCode: countryCode?.toLowerCase() || '',
          state: state?.toLowerCase() || '',
          organizationType: organizationType?.toLowerCase(),
        }
      : undefined;

  const sizeCandidate =
    normalizeString(input?.size) ||
    normalizeString(organizationInfo?.organizationSize) ||
    normalizeString(organizationInfo?.orgSize);
  const size =
    sizeCandidate && ['SMALL', 'MEDIUM', 'LARGE'].includes(sizeCandidate.toUpperCase())
      ? (sizeCandidate.toUpperCase() as NormalizedOrganizationPayload['size'])
      : undefined;

  if (organizationInfo && Object.keys(organizationInfo).length > 0) {
    if (!name) {
      errors.push({ field: 'organizationInfo.organizationName', message: 'Organization name is required' });
    }
    if (!organizationType) {
      errors.push({ field: 'organizationInfo.organizationType', message: 'Organization type is required' });
    }
    if (!orgAddress || Object.keys(orgAddress).length === 0) {
      errors.push({ field: 'organizationInfo.organizationAdd', message: 'Organization address is required' });
    } else {
      if (!address) errors.push({ field: 'organizationInfo.organizationAdd.address', message: 'Address is required' });
      if (!city) errors.push({ field: 'organizationInfo.organizationAdd.city', message: 'City is required' });
      if (!state) errors.push({ field: 'organizationInfo.organizationAdd.state', message: 'State is required' });
      if (!country) errors.push({ field: 'organizationInfo.organizationAdd.country', message: 'Country is required' });
      if (!postalCode) errors.push({ field: 'organizationInfo.organizationAdd.postalCode', message: 'Postal code is required' });
    }
  }

  return {
    data: {
      organizationId,
      parentOrgId,
      name,
      email,
      phone,
      phoneCode,
      phoneNumber,
      address,
      city,
      state,
      country,
      countryCode,
      postalCode,
      status: input?.status || organizationInfo?.status,
      organizationType,
      organizationSize,
      noOfBranches,
      hospitalImage,
      googleMapsLink,
      hospitalBio,
      licenseNumber,
      scheduleConf,
      defaultSetting,
      goals,
      thresholds,
      workingHours,
      specialization,
      certifications,
      servicesOffered,
      appointmentType,
      facilityType,
      equipmentAvailable,
      emergencySupport,
      industryType,
      wellnessPrograms,
      onsiteFacilities,
      employeeCoverage,
      insurancePartnerships,
      remoteWellnessSupport,
      corporateDiscounts,
      adminDetails,
      modules,
      devices,
      supportedVitals,
      organizationInfo: organizationInfoOutput,
      searchFields,
      website,
      taxId,
      registrationNumber,
      description,
      industry,
      size,
      integration,
      subdomain: integrationSubdomain,
      organizationConfig,
    },
    errors,
  };
};

export const generateOrganizationId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(16).slice(2, 10);
  return `${timestamp}${random}`;
};
