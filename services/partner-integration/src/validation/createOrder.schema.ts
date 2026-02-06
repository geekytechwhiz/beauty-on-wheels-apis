import { z } from 'zod';

const prioritySchema = z.enum(['ROUTINE', 'URGENT', 'STAT']);

export const createOrderSchema = z
  .object({
    partnerId: z.string().min(1).max(128),
    patientId: z.string().min(1).max(256),
    patientName: z.string().max(512).optional(),
    testCodes: z.array(z.string().min(1).max(64)).min(1).max(100),
    specimenType: z.string().max(128).optional(),
    priority: prioritySchema.optional(),
    notes: z.string().max(2000).optional(),
    externalReferenceId: z.string().max(256).optional(),
  })
  .strict();

export type CreateOrderBody = z.infer<typeof createOrderSchema>;
