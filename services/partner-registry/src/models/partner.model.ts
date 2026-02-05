import type {
  Partner,
  PartnerStatusExtended,
  PartnerEndpoint,
  PrimaryContact,
  OnboardingInfo,
} from '@api-hub/partners';

export type { Partner, PartnerStatusExtended, PartnerEndpoint, PrimaryContact, OnboardingInfo };

export type OrganizationType =
  | 'HOSPITAL'
  | 'CLINIC'
  | 'LAB'
  | 'PHARMACY'
  | 'WELLNESS_CENTER'
  | 'CORPORATE'
  | 'OTHER';

export type OrganizationSize = 'SMALL' | 'MEDIUM' | 'LARGE';

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
  status?: PartnerStatusExtended;
  onboarding?: OnboardingInfo;
  description?: string;
  endpoints?: PartnerEndpoint[];
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
  
  status?: PartnerStatusExtended;
  
  onboarding?: Partial<OnboardingInfo>;
  description?: string;
  endpoints?: PartnerEndpoint[];
}
