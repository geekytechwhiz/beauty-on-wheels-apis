import { z } from 'zod';
import { defineEvent } from '@api-hub/event-platform';
const priorityBandZ = z.enum(['P0', 'P1', 'P2', 'P3']);


export const AlertPriorityChangedEventSchema = defineEvent(
  z.object({
    alertIds: z
      .array(z.string().trim().min(1))
      .min(1, 'At least one alertId is required')
      .max(50, 'Maximum 50 alertIds per request'),
    priority: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
      priorityBandZ,
    ),
    performedByDisplayName: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v),
      z.string().min(1),
    ),
  }),
  {
    eventType: 'Alert.PriorityChanged.v1',
    eventVersion: '1.0.0',
    source: 'alert-service',
    transport: 'eventbridge',
  },
);

export type AlertPriorityChangedEventPayload = z.infer<typeof AlertPriorityChangedEventSchema>;
