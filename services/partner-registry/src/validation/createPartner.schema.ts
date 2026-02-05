import { z } from 'zod';
import type {
  PartnerStatusExtended,
  EndpointType,
  PrimaryContact,
  OnboardingInfo,
  OrganizationType,
  OrganizationSize,
} from '@api-hub/partners';

// Status enum values from shared type
const PARTNER_STATUS_VALUES: [PartnerStatusExtended, ...PartnerStatusExtended[]] = [
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
  'INACTIVE',
];

// Endpoint type enum values from shared type
const ENDPOINT_TYPE_VALUES: [EndpointType, ...EndpointType[]] = ['API', 'WEBHOOK', 'FHIR'];

// Organization type enum values from shared type
const ORGANIZATION_TYPE_VALUES: [OrganizationType, ...OrganizationType[]] = [
  'HOSPITAL',
  'CLINIC',
  'LAB',
  'PHARMACY',
  'WELLNESS_CENTER',
  'CORPORATE',
  'OTHER',
];

// Organization size enum values from shared type
const ORGANIZATION_SIZE_VALUES: [OrganizationSize, ...OrganizationSize[]] = ['SMALL', 'MEDIUM', 'LARGE'];

const endpointSchema = z.object({
  type: z.enum(ENDPOINT_TYPE_VALUES),
  url: z.string().url(),
  description: z.string().optional(),
});

const primaryContactSchema: z.ZodType<PrimaryContact> = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  phoneCode: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const onboardingSchema: z.ZodType<OnboardingInfo> = z.object({
  submittedAt: z.number().optional(),
  approvedAt: z.number().optional(),
  approvedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export const createPartnerSchema = z.object({
  organizationName: z.string().min(1).max(255),

  legalName: z.string().max(255).optional(),
  organizationType: z.enum(ORGANIZATION_TYPE_VALUES).optional(),
  organizationSize: z.enum(ORGANIZATION_SIZE_VALUES).optional(),
  noOfBranches: z.string().optional(),

  email: z.string().email().optional(),
  phoneCode: z.string().optional(),
  phoneNumber: z.string().optional(),
  primaryContact: primaryContactSchema.optional(),

  // Address Information
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  countryCode: z.string().max(10).optional(),
  postalCode: z.string().max(20).optional(),
  googleMapsLink: z.string().url().optional(),

  website: z.string().url().optional(),
  organizationImage: z.string().url().optional(),
  organizationBio: z.string().max(2000).optional(),
  registrationNumber: z.string().max(100).optional(),
  taxId: z.string().max(100).optional(),

  // Status - using shared type
  status: z.enum(PARTNER_STATUS_VALUES).optional().default('PENDING_APPROVAL'),

  // Onboarding
  onboarding: onboardingSchema.optional(),
  description: z.string().max(2000).optional(),
  endpoints: z.array(endpointSchema).optional(),
});

export type CreatePartnerBody = z.infer<typeof createPartnerSchema>;
