import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { z } from 'zod';

const businessInfo = z.object({
  businessType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  businessName: z.string().trim().min(2).max(150).optional(),
  contactName: z.string().trim().min(2).max(100).optional(),
  phoneNumber: z.string().trim().min(5).max(20).optional(),
  email: z.string().email().nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  gstNumber: z.string().trim().max(20).nullable().optional(),
  panNumber: z.string().trim().max(20).nullable().optional(),
  profileImageUrl: z.string().url().nullable().optional(),
}).strict();

const communities = z.object({
  communityIds: z.array(z.string().trim().min(1).max(64)).max(25),
}).strict();

const bankDetails = z.object({
  accountHolderName: z.string().trim().min(2).max(150).optional(),
  accountNumber: z.string().regex(/^\d{8,18}$/).nullable().optional(),
  ifscCode: z.string().trim().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).nullable().optional(),
  bankName: z.string().trim().min(2).max(150).optional(),
  branchName: z.string().trim().max(150).nullable().optional(),
  accountType: z.enum(['SAVINGS', 'CURRENT']).nullable().optional(),
}).strict();

export const UpdateOnboardingRequestSchema = z.object({
  revision: z.number().int().nonnegative(),
  sections: z.object({
    BUSINESS_INFO: businessInfo.optional(),
    COMMUNITIES: communities.optional(),
    BANK_DETAILS: bankDetails.optional(),
  }).strict().refine((sections) => Object.keys(sections).length > 0, 'At least one onboarding section is required'),
  lastVisitedStep: z.enum(['BUSINESS_INFO', 'COMMUNITIES', 'DOCUMENTS', 'BANK_DETAILS']).optional(),
}).strict();

export type UpdateOnboardingRequest = z.infer<typeof UpdateOnboardingRequestSchema>;

export function validateUpdateOnboardingRequest(req: LambdaRequest): UpdateOnboardingRequest {
  const result = UpdateOnboardingRequestSchema.safeParse(req.body);
  if (!result.success) throw new EventSchemaError('Request validation failed', result.error);
  req.body = result.data;
  return result.data;
}
