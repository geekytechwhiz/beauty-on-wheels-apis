import { z } from 'zod';

export const baseCancelOrderSchema = z
  .object({
    partnerId: z.string().min(1),
    orderId: z.string().min(1),
    remark: z.string().optional(),
  })
  .strict();

export type BaseCancelOrderInput = z.infer<typeof baseCancelOrderSchema>;
