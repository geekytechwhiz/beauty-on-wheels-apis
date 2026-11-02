import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { COVERAGE_DECISION_STATUSES } from '../domain/community';

const communityId = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);

export const ReplaceVendorCommunitiesRequestSchema = z
  .object({
    communityIds: z.array(communityId).max(25),
  })
  .strict();

export const AddVendorCommunityRequestSchema = z
  .object({
    communityId,
  })
  .strict();

/** Vendor coverage replace. The caller must send the profile updatedAt loaded with the current set. */
export const ReplacePartnerCommunityCoverageRequestSchema = z
  .object({
    communityIds: z.array(communityId).max(25),
    expectedUpdatedAt: z.string().trim().min(1).max(40),
  })
  .strict();

/** Admin decision on one community of one vendor. */
export const CommunityCoverageApprovalRequestSchema = z
  .object({
    status: z.enum(COVERAGE_DECISION_STATUSES),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const validateCommunityCoverageApprovalRequest = (req: LambdaRequest) => {
  const result = CommunityCoverageApprovalRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateReplaceVendorCommunitiesRequest = (req: LambdaRequest) => {
  const result = ReplaceVendorCommunitiesRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateAddVendorCommunityRequest = (req: LambdaRequest) => {
  const result = AddVendorCommunityRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateReplacePartnerCommunityCoverageRequest = (req: LambdaRequest) => {
  const result = ReplacePartnerCommunityCoverageRequestSchema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
