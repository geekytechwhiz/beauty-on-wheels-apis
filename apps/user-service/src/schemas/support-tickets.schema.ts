import { EventSchemaError } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { z } from 'zod';

import { SupportTicketCreate } from '../types/api-types';

export const SUPPORT_TICKET_MESSAGE_MAX = 4000;

export const SupportTicketCreateSchema = z
  .object({
    category: z.enum(['BOOKING', 'PAYMENT', 'ACCOUNT']),
    bookingId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'bookingId is invalid')
      .optional(),
    message: z.string().trim().min(1).max(SUPPORT_TICKET_MESSAGE_MAX),
  })
  .strict();

export const validateSupportTicketCreate = (
  req: LambdaRequest,
): SupportTicketCreate => {
  const result = SupportTicketCreateSchema.safeParse(req.body ?? {});
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
};
