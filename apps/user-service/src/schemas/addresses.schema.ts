import { z } from 'zod';
import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { ADDRESS_TYPE } from '../domain/constants';
import { AddressRequest } from '../types/api-types';

export const AddressRequestSchema = z
  .object({
    type: z
      .enum([ADDRESS_TYPE.HOME, ADDRESS_TYPE.WORK, ADDRESS_TYPE.BUSINESS])
      .optional(),

    communityId: z.string().trim().min(1),

    line1: z.string().trim().min(1).max(200),

    line2: z.string().trim().max(200).optional(),

    city: z.string().trim().min(1).max(80),

    state: z.string().trim().min(1).max(80),

    postalCode: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/, 'Invalid Indian postal code')
      .optional(),

    isDefault: z.boolean().optional(),
  })
  .strict();

export const validateAddressRequest = (req: LambdaRequest): AddressRequest => {
  const result = AddressRequestSchema.safeParse(req.body ?? {});

  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }

  req.body = result.data;
  return result.data;
};
