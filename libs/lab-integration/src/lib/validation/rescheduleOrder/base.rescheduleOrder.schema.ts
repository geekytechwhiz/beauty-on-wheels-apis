import { z } from 'zod';

export const baseRescheduleOrderSchema = z
  .object({
    partnerId: z.string().min(1),
    orderId: z.string().min(1),
  })
  .strict();

export type BaseRescheduleOrderInput = z.infer<
  typeof baseRescheduleOrderSchema
>;
