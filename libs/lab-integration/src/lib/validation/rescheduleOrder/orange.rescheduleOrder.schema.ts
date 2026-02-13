import { z } from 'zod';

export const orangeRescheduleOrderSchema = z
  .object({
    partnerId: z.string().min(1),
    orderId: z.string().min(1),
    newScheduledDate: z.string().optional(),
  })
  .strict();

export type OrangeRescheduleOrderInput = z.infer<
  typeof orangeRescheduleOrderSchema
>;
