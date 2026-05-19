import { z } from 'zod';

import { defineEvent } from '@api-hub/event-platform';

export const AlertCreatedEventSchema = defineEvent(
  z.object({
    alertId: z.string(),

    patientId: z.string(),

    organizationId: z.string(),

    priority: z.enum([
      'P0',
      'P1',
      'P2',
    ]),

    state: z.enum([
      'UNASSIGNED',
      'ASSIGNED',
    ]),

    createdAt: z.string(),
  }),
  {
    eventType: 'Alert.Created.v1',

    eventVersion: '1.0.0',

    source: 'alert-service',

    transport: 'eventbridge',
  },
);