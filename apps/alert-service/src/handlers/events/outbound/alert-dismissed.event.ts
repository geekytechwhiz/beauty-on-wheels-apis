import { defineEvent } from '@api-hub/event-platform';
import { z } from 'zod';

export const AlertDismissedEventSchema = defineEvent(
  z.object({
    alertId: z.string(),
    patientId: z.string(),
    organizationId: z.string(),
    previousState: z.string(),
    currentState: z.string(),
    performedBy: z.string(),
    performedByDisplayName: z.string().optional(),
    activityComment: z.string().optional(),
    occurredAt: z.string(),
  }),
  {
    eventType: 'Alert.Dismissed.v1',
    eventVersion: '1.0.0',
    source: 'alert-service',
    transport: 'eventbridge',
  },
);
