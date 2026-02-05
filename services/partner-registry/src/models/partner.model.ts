import type {
  Partner,
  PartnerStatusExtended,
  PartnerEndpoint,
  PrimaryContact,
  OnboardingInfo,
  OrganizationType,
  OrganizationSize,
} from '@api-hub/partners';

export type {
  Partner,
  PartnerStatusExtended,
  PartnerEndpoint,
  PrimaryContact,
  OnboardingInfo,
  OrganizationType,
  OrganizationSize,
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
