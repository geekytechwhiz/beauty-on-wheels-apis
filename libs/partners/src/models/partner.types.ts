/**
 * Partner domain types (read-only / shared).
 */

export type PartnerStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REJECTED'
  | 'INACTIVE';

export type EndpointType = 'API' | 'WEBHOOK' | 'FHIR';

/**
 * Auth mechanism for outbound calls to partner.
 * API_KEY / BEARER: credentialsSecretArn holds raw key or JSON { apiKey }.
 * OAUTH_CLIENT_CREDENTIALS: secret holds client_id, client_secret; oauthTokenUrl required.
 */
export type PartnerAuthType = 'API_KEY' | 'BEARER' | 'OAUTH_CLIENT_CREDENTIALS';

/**
 * Partner-level auth config (registry-driven).
 * Credentials stored in Secrets Manager; only ARN/name stored in registry.
 */
export interface PartnerAuthConfig {
  authType: PartnerAuthType;
  /** Secrets Manager secret ARN or name. For API_KEY/BEARER: raw string or { apiKey }. For OAuth: { client_id, client_secret }. */
  credentialsSecretArn: string;
  /** Required when authType is OAUTH_CLIENT_CREDENTIALS. */
  oauthTokenUrl?: string;
}

export type OrganizationType =
  | 'HOSPITAL'
  | 'CLINIC'
  | 'LAB'
  | 'PHARMACY'
  | 'WELLNESS_CENTER'
  | 'CORPORATE'
  | 'OTHER';

export type OrganizationSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface PartnerEndpoint {
  type: EndpointType;
  url: string;
  description?: string;
}

/**
 * Integration/adapter key for resolving adapter at runtime (e.g. "lab", "redcliffe", "orange").
 * Enables registry-driven adapter selection without code deploy for new partners of known types.
 */
export type IntegrationType = string;

export interface PrimaryContact {
  name: string;
  email: string;
  phoneCode?: string;
  phoneNumber?: string;
}

export interface OnboardingInfo {
  submittedAt?: number;
  approvedAt?: number;
  approvedBy?: string;
  rejectionReason?: string;
}

export interface PartnerMeta {
  partnerId: string;
  status: PartnerStatus;
  displayName?: string;
  description?: string;
  endpoints?: PartnerEndpoint[];
  /** Auth for outbound calls to this partner. Resolved at runtime via credentialsSecretArn. */
  authConfig?: PartnerAuthConfig;
  /** Adapter/integration key (e.g. "lab", "redcliffe", "orange") for registry-driven adapter resolution. */
  adapterKey?: IntegrationType;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  modifiedBy?: string;
  isDeleted?: boolean;
}

export interface Partner extends PartnerMeta {
  organizationName?: string;
  legalName?: string;
  organizationType?: OrganizationType;
  organizationSize?: OrganizationSize;
  noOfBranches?: string;

  email?: string;
  phoneCode?: string;
  phoneNumber?: string;
  primaryContact?: PrimaryContact;

  address?: string;
  city?: string;
  state?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  googleMapsLink?: string;

  website?: string;
  organizationImage?: string;
  organizationBio?: string;
  registrationNumber?: string;
  taxId?: string;

  onboarding?: OnboardingInfo;
}
