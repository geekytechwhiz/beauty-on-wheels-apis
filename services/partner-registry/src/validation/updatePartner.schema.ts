import { z } from 'zod';
import type { PrimaryContact, OnboardingInfo } from '../models/partner.model';

const PARTNER_STATUS_VALUES = ['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'INACTIVE'] as const;
const ENDPOINT_TYPE_VALUES = ['API', 'WEBHOOK', 'FHIR'] as const;
const ORGANIZATION_TYPE_VALUES = [
  'HOSPITAL',
  'CLINIC',
  'LAB',
  'PHARMACY',
  'WELLNESS_CENTER',
  'CORPORATE',
  'OTHER',
] as const;
const ORGANIZATION_SIZE_VALUES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
const PARTNER_AUTH_TYPE_VALUES = ['API_KEY', 'BEARER', 'OAUTH_CLIENT_CREDENTIALS'] as const;

const endpointSchema = z.object({
  type: z.enum(ENDPOINT_TYPE_VALUES),
  url: z.string().url(),
  description: z.string().optional(),
});

const authConfigSchema = z.object({
  authType: z.enum(PARTNER_AUTH_TYPE_VALUES),
  credentialsSecretArn: z.string().min(1).max(512),
  oauthTokenUrl: z.string().url().optional(),
});

const primaryContactSchema: z.ZodType<PrimaryContact> = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  phoneCode: z.string().min(1),
  phoneNumber: z.string().min(1),
});

const onboardingSchema: z.ZodType<OnboardingInfo> = z.object({
  submittedAt: z.number().optional(),
  approvedAt: z.number().optional(),
  approvedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export const updatePartnerSchema = z.object({
  // Basic Information
  organizationName: z.string().min(1).max(255).optional(),
  legalName: z.string().min(1).max(255).optional(),
  organizationType: z.enum(ORGANIZATION_TYPE_VALUES).optional(),
  organizationSize: z.enum(ORGANIZATION_SIZE_VALUES).optional(),
  noOfBranches: z.string().optional(),

  email: z.string().email().optional(),
  phoneCode: z.string().min(1).optional(),
  phoneNumber: z.string().min(1).optional(),
  primaryContact: primaryContactSchema.optional(),

  address: z.string().min(1).max(500).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  countryCode: z.string().min(1).max(10).optional(),
  postalCode: z.string().min(1).max(20).optional(),
  googleMapsLink: z.string().url().optional(),

  website: z.string().url().optional(),
  organizationImage: z.string().url().optional(),
  organizationBio: z.string().max(2000).optional(),
  registrationNumber: z.string().max(100).optional(),
  taxId: z.string().max(100).optional(),

  // Status - using shared type
  status: z.enum(PARTNER_STATUS_VALUES).optional(),

  onboarding: onboardingSchema.optional(),

  description: z.string().max(2000).optional(),
  endpoints: z.array(endpointSchema).optional(),
  authConfig: authConfigSchema.optional(),
  adapterKey: z.string().min(1).max(128).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field required' });

export type UpdatePartnerBody = z.infer<typeof updatePartnerSchema>;
