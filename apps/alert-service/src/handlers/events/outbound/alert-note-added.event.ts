import { defineEvent } from '@api-hub/event-platform';
import { z } from 'zod';

export const AlertNoteAddedEventSchema = defineEvent(
  z.object({
    alertId: z.string(),
    patientId: z.string(),
    organizationId: z.string(),
    activityId: z.string(),
    comment: z.string(),
    performedBy: z.string(),
    performedByDisplayName: z.string().optional(),
    occurredAt: z.string(),
  }),
  {
    eventType: 'Alert.NoteAdded.v1',
    eventVersion: '1.0.0',
    source: 'alert-service',
    transport: 'eventbridge',
  },
);
