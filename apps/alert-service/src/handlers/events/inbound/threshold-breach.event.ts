import { z } from 'zod';

import { defineEvent } from '@api-hub/event-platform';

export const ThresholdBreachEventSchema = defineEvent(
  z.object({
    patientId: z.string(),
    organizationId: z.string(),

    metric: z.string(),

    currentValue: z.number(),

    threshold: z.number(),

    severity: z.enum([
      'LOW',
      'MEDIUM',
      'HIGH',
      'CRITICAL',
    ]),

    triggeredAt: z.string(),
  }),
  {
    eventType: 'Threshold.Breach.v1',

    eventVersion: '1.0.0',

    source: 'monitoring-service',

    transport: 'eventbridge',
  },
);