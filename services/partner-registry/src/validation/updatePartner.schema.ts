import { z } from 'zod';

const endpointSchema = z.object({
  type: z.enum(['API', 'WEBHOOK', 'FHIR']),
  url: z.string().url(),
  description: z.string().optional(),
});

export const updatePartnerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  displayName: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  endpoints: z.array(endpointSchema).optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field required' });

export type UpdatePartnerBody = z.infer<typeof updatePartnerSchema>;
