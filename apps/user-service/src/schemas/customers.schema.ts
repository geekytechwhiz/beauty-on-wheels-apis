import { z } from 'zod';
import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { USER_STATUS } from '../domain/constants';
import { CustomerProfileUpdate } from '../types/api-types';

export const CustomerProfileUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().min(8).max(20).nullable().optional(),
    profileImage: z.string().trim().url().max(2048).optional(),
    status: z
      .enum([USER_STATUS.ACTIVE, USER_STATUS.INACTIVE, USER_STATUS.SUSPENDED])
      .optional(),
    preferredLanguage: z.string().trim().min(2).max(35).optional(),
    loyaltyPoints: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const validateCustomerProfileUpdate = (
  req: LambdaRequest,
): CustomerProfileUpdate => {
  const result = CustomerProfileUpdateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
