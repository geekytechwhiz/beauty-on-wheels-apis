import type { Partner, PartnerStatus, PartnerEndpoint } from '@api-hub/partners';

/** Auth config for outbound calls; matches @api-hub/partners PartnerAuthConfig. */
export interface PartnerAuthConfig {
  authType: 'API_KEY' | 'BEARER' | 'OAUTH_CLIENT_CREDENTIALS';
  credentialsSecretArn: string;
  oauthTokenUrl?: string;
}

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

export type OrganizationType =
  | 'HOSPITAL'
  | 'CLINIC'
  | 'LAB'
  | 'PHARMACY'
  | 'WELLNESS_CENTER'
  | 'CORPORATE'
  | 'OTHER';

export type OrganizationSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export type {
  Partner,
  PartnerStatus,
  PartnerEndpoint,
};

export interface CreatePartnerInput {
  organizationName: string;

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
  status?: PartnerStatus;
  onboarding?: OnboardingInfo;
  description?: string;
  endpoints?: PartnerEndpoint[];
  authConfig?: PartnerAuthConfig;
  adapterKey?: string;
}

export interface UpdatePartnerInput {
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
  
  status?: PartnerStatus;
  
  onboarding?: Partial<OnboardingInfo>;
  description?: string;
  endpoints?: PartnerEndpoint[];
  authConfig?: PartnerAuthConfig;
  adapterKey?: string;
}
