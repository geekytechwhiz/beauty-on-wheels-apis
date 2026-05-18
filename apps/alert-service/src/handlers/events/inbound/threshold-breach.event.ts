import { defineEvent } from '@api-hub/event-platform';

import { thresholdBreachPayloadSchema } from './threshold-breach.payload';

export type { ThresholdBreachEventPayload } from './threshold-breach.payload';

export const ThresholdBreachEventSchema = defineEvent(thresholdBreachPayloadSchema, {
  eventType: 'ThresholdBreach.v1',
  eventVersion: '1.0.0',
  source: 'monitoring-service',
  transport: 'eventbridge',
});
