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
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().min(1).max(200).optional(),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80).optional(),
    postalCode: z.string().trim().min(1).max(20).optional(),
    country: z.string().trim().min(2).max(80).optional(),
    latitude: z.number().gte(-90).lte(90).optional(),
    longitude: z.number().gte(-180).lte(180).optional(),
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
