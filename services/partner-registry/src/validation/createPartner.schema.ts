import { z } from 'zod';

const endpointSchema = z.object({
  type: z.enum(['API', 'WEBHOOK', 'FHIR']),
  url: z.string().url(),
  description: z.string().optional(),
});

export const createPartnerSchema = z.object({
  name: z.string().min(1).max(255),
  displayName: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional().default('ACTIVE'),
  endpoints: z.array(endpointSchema).optional(),
});

export type CreatePartnerBody = z.infer<typeof createPartnerSchema>;
