import { defineEvent } from '@api-hub/event-platform';
import { z } from 'zod';

export const OrgConfigPublishedEventSchema = defineEvent(
  z.object({
    organizationId: z.string(),
    orgConfigVersion: z.number(),
    changeType: z.enum(['initial', 'update']),
    changedSections: z.array(z.string()),
    publishedAt: z.string(),
    publishedBy: z.string().optional(),
  }),
  {
    eventType: 'OrgConfigPublished.v1',
    eventVersion: '1.0.0',
    source: 'organization-service',
    transport: 'eventbridge',
  },
);

export type OrgConfigPublishedPayload = z.infer<typeof OrgConfigPublishedEventSchema>;
