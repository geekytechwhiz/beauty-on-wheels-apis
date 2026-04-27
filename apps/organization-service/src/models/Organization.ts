export interface Organization {
  pk: string;
  sk: string;
  gsi1pk?: string;
  gsi1sk?: string;
  gsi2pk?: string;
  gsi2sk?: string;
  organizationId: string;
  createdAt?: number;
  createdBy?: string;
  modifiedBy?: string;
  traceId?: string;
  parentOrgId?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';
  createdDate?: number;
  modifiedDate: number;
  deleted?: boolean;
  itemType: 'ORG_DETAILS';
  lsi_createdAt?: number;
  lsi_entityType?: string;
  lsi_organizationType?: string;
  lsi_status?: string;
  organizationType?: string;
  organizationSize?: string;
  noOfBranches?: string;
  phoneCode?: string;
  phoneNumber?: string;
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
  organizationInfo?: unknown;
  searchFields?: unknown;
  website?: string;
  subdomain?: string;
  taxId?: string;
  registrationNumber?: string;
  description?: string;
  industry?: string;
  size?: 'SMALL' | 'MEDIUM' | 'LARGE';
  integration?: Integration;
  sourceSystem: string; // TruTech
}
export interface Integration {
  provider?: string; // e.g. TruTech provider id for GSI2
  providerName?: string; // provider name from the provider service
  sourceSystem?: 'HMS' | 'FHIR' | 'CUSTOM' | 'MARKETPLACE'; // integration / source system from the provider service
  externalHospitalId?: string; // external hospital id from the provider service
  apiBaseUrl?: string; // provider API base URL (for HMS tenant resolution)
  apiKey?: string; // transient request field, persisted in Secrets Manager only
  apiKeyRef?: string; // secrets manager reference for provider API key
  subdomain?: string; // subdomain from the provider service
  metadata?: Record<string, unknown>; // metadata from the provider service
}
