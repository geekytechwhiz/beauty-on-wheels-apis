import { defineEvent } from '@api-hub/event-platform';
import { z } from 'zod';

const priorityBandZ = z.enum(['P0', 'P1', 'P2', 'P3']);

export const AlertPriorityChangedEventSchema = defineEvent(
  z.object({
    alertId: z.string(),
    patientId: z.string(),
    organizationId: z.string(),
    previousPriority: priorityBandZ,
    newPriority: priorityBandZ,
    performedBy: z.string(),
    performedByDisplayName: z.string().optional(),
    occurredAt: z.string(),
  }),
  {
    eventType: 'Alert.PriorityChanged.v1',
    eventVersion: '1.0.0',
    source: 'alert-service',
    transport: 'eventbridge',
  },
);
