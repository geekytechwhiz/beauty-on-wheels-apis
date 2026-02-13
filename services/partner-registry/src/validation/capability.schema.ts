import { z } from 'zod';

export const setCapabilitySchema = z.object({
  interopMode: z.enum(['FHIR', 'NON_FHIR']),
  version: z.string().max(64).optional(),
});

export type SetCapabilityBody = z.infer<typeof setCapabilitySchema>;
