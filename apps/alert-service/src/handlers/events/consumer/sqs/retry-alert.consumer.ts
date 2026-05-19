import { z } from 'zod';

import { createSqsEventHandler } from '@api-hub/event-platform';
import { defineEvent } from '@api-hub/event-platform';

const RetryAlertEventSchema = defineEvent(
  z.object({
    alertId: z.string(),
    organizationId: z.string(),
    reason: z.string(),
    requestedAt: z.string(),
  }),
  {
    eventType: 'Alert.Retry.v1',
    eventVersion: '1.0.0',
    source: 'alert-service',
    transport: 'sqs',
  },
);

export const handler = createSqsEventHandler({
  operation: 'alert.retry',
  events: [
    {
      schema: RetryAlertEventSchema,
      handler: async (event) => {
        void event;
      },
    },
  ],
});
