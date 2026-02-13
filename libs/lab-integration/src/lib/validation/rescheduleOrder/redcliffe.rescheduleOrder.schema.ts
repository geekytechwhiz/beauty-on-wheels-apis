import { z } from 'zod';

const datePattern = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const redcliffeRescheduleOrderSchema = z
  .object({
    partnerId: z.string().min(1),
    orderId: z.string().min(1),
    collectionDate: datePattern,
    collectionSlot: z.number().int().positive(),
    remark: z.string().optional(),
  })
  .strict();

export type RedcliffeRescheduleOrderInput = z.infer<
  typeof redcliffeRescheduleOrderSchema
>;
