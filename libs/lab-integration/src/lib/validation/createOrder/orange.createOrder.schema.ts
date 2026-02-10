import { z } from 'zod';

const prioritySchema = z.enum(['ROUTINE', 'URGENT', 'STAT']);

/**
 * Orange Health create order schema.
 * Update required/optional fields after verifying Orange Health API documentation.
 */
export const orangeCreateOrderSchema = z
  .object({
    partnerId: z.string().min(1),
    patientId: z.string().min(1),
    patientName: z.string().optional(),
    testCodes: z.array(z.string()).min(1),
    scheduledDate: z.string().optional(),
    priority: prioritySchema.optional(),
    notes: z.string().optional(),
    externalReferenceId: z.string().optional(),
  })
  .strict();

export type OrangeCreateOrderInput = z.infer<typeof orangeCreateOrderSchema>;
