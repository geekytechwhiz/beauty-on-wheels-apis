import { z } from 'zod';

export const createCarePlanDraftBodySchema = z.object({
  templateId: z.string().min(1),
  patientId: z.string().min(1),
  effectiveDate: z.string().min(1),
  version: z.string().min(1).optional(),
  context: z.record(z.string(), z.unknown()).default({}),
});

export type CreateCarePlanDraftBody = z.infer<typeof createCarePlanDraftBodySchema>;
