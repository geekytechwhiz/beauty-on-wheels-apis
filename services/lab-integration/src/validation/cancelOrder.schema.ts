import { z } from 'zod';

/**
 * Path params for cancel: orderId required.
 * Body can be empty or contain optional reason.
 */
export const cancelOrderPathSchema = z.object({
  orderId: z.string().min(1).max(256),
});

export const cancelOrderBodySchema = z
  .object({
    partnerId: z.string().min(1).max(128),
    reason: z.string().max(500).optional(),
  })
  .strict();

export type CancelOrderPath = z.infer<typeof cancelOrderPathSchema>;
