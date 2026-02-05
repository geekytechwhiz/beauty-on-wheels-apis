import { z } from 'zod';

const endpointSchema = z.object({
  type: z.enum(['API', 'WEBHOOK', 'FHIR']),
  url: z.string().url(),
  description: z.string().optional(),
});

const primaryContactSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  phoneCode: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const onboardingSchema = z.object({
  submittedAt: z.number().optional(),
  approvedAt: z.number().optional(),
  approvedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export const updatePartnerSchema = z.object({
  // Basic Information
  organizationName: z.string().min(1).max(255).optional(),
  legalName: z.string().max(255).optional(),
  organizationType: z.enum(['HOSPITAL', 'CLINIC', 'LAB', 'PHARMACY', 'WELLNESS_CENTER', 'CORPORATE', 'OTHER']).optional(),
  organizationSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional(),
  noOfBranches: z.string().optional(),
  

  email: z.string().email().optional(),
  phoneCode: z.string().optional(),
  phoneNumber: z.string().optional(),
  primaryContact: primaryContactSchema.optional(),
  
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
  
  // Status
  status: z.enum(['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'INACTIVE']).optional(),

  onboarding: onboardingSchema.optional(),
  
  description: z.string().max(2000).optional(),
  endpoints: z.array(endpointSchema).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field required' });

export type UpdatePartnerBody = z.infer<typeof updatePartnerSchema>;
