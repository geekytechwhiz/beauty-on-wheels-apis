import { z } from 'zod';

/**
 * Path params for status: orderId required.
 */
export const statusPathSchema = z.object({
  orderId: z.string().min(1).max(256),
});

/**
 * Query params: partnerId required to resolve which lab partner to call.
 */
export const statusQuerySchema = z.object({
  partnerId: z.string().min(1).max(128),
});

export type StatusPath = z.infer<typeof statusPathSchema>;
export type StatusQuery = z.infer<typeof statusQuerySchema>;
