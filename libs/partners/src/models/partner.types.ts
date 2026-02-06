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

export interface PrimaryContact {
  name: string;
  email: string;
  phoneCode: string;
  phoneNumber: string;
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
