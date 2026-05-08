import { defineEvent } from '@api-hub/event-platform';
import { z } from 'zod';

export const AlertStateChangedSchema = defineEvent(
  z.object({
    alertId: z.string(),
    patientId: z.string(),
    orgId: z.string(),

    previousState: z.string(),
    currentState: z.string(),

    changedBy: z.string(),

    changedAt: z.string(),
  }),
  {
    eventType: 'Alert.StateChanged.v1',
    eventVersion: '1.0.0',
    source: 'alert-service',
  },
);