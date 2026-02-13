import { z } from 'zod';

const prioritySchema = z.enum(['ROUTINE', 'URGENT', 'STAT']);

export const orangeCreateOrderSchema = z
  .object({
    partnerId: z.string().min(1),
    patientId: z.string().min(1),
    patientName: z.string().max(512).optional(),
    testCodes: z.array(z.string().min(1).max(64)).min(1).max(100),
    scheduledDate: z.string().optional(), // Date format to be verified
    priority: prioritySchema.optional(),
    notes: z.string().max(2000).optional(),
    externalReferenceId: z.string().max(256).optional(),
    specimenType: z.string().max(128).optional(),
  })
  .strict();

export type OrangeCreateOrderInput = z.infer<typeof orangeCreateOrderSchema>;
