import type { Partner, PartnerStatus, PartnerEndpoint } from '@api-hub/partners';

export type { Partner, PartnerStatus, PartnerEndpoint };

export type OrganizationType =
  | 'HOSPITAL'
  | 'CLINIC'
  | 'LAB'
  | 'PHARMACY'
  | 'WELLNESS_CENTER'
  | 'CORPORATE'
  | 'OTHER';

export type OrganizationSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export type PartnerStatusExtended =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REJECTED'
  | 'INACTIVE';

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
