import { z } from 'zod';
import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { COMMUNITY_STATUS } from '../domain/constants';
import {
  CommunityCreate,
  CommunityUpdate,
  CustomerCommunitiesUpdate,
} from '../types/api-types';

const communityCode = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(40);

export const CommunityCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: communityCode.optional(),
    city: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const CommunityUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    code: communityCode.optional(),
    city: z.string().trim().min(1).max(80).optional(),
    status: z.enum([COMMUNITY_STATUS.ACTIVE, COMMUNITY_STATUS.INACTIVE]).optional(),
  })
  .strict();

export const CustomerCommunitiesUpdateSchema = z
  .object({
    communityIds: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .strict();

export const validateCommunityCreate = (req: LambdaRequest): CommunityCreate => {
  const result = CommunityCreateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateCommunityUpdate = (req: LambdaRequest): CommunityUpdate => {
  const result = CommunityUpdateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};

export const validateCustomerCommunitiesUpdate = (
  req: LambdaRequest,
): CustomerCommunitiesUpdate => {
  const result = CustomerCommunitiesUpdateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
