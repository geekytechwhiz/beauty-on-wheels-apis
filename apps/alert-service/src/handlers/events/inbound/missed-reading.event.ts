import { defineEvent } from '@api-hub/event-platform';

import { missedReadingPayloadSchema } from './missed-reading.payload';

export type { MissedReadingEventPayload } from './missed-reading.payload';

export const MissedReadingEventSchema = defineEvent(missedReadingPayloadSchema, {
  eventType: 'MissedReading.v1',
  eventVersion: '1.0.0',
  source: 'device-monitoring',
  transport: 'eventbridge',
});
