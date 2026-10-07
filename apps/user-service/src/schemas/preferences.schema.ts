import { z } from 'zod';
import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';

import { OperationalPreferencesUpdate } from '../types/api-types';

export const OperationalPreferencesUpdateSchema = z
  .object({
    whatsapp: z.boolean(),
    sms: z.boolean(),
    email: z.boolean(),
    push: z.boolean(),
    language: z.string().trim().min(2).max(35).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const validateOperationalPreferencesUpdate = (
  req: LambdaRequest,
): OperationalPreferencesUpdate => {
  const result = OperationalPreferencesUpdateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
