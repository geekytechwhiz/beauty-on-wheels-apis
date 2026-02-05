import { z } from 'zod';

export const linkOrgPartnerSchema = z.object({
  partnerId: z.string().min(1),
  relationshipType: z.string().max(64).optional(),
});

export type LinkOrgPartnerBody = z.infer<typeof linkOrgPartnerSchema>;
