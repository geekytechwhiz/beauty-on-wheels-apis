import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

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
