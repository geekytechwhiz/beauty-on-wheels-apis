import {
  configureEventPlatform,
  EventBridgeAdapter,
  BookingReadinessFactUpdatedEvent,
  BOOKING_READINESS_FACT_EVENT_TYPE,
  BOOKING_READINESS_FACT_EVENT_VERSION,
} from '@api-hub/event-platform';

import { env } from '../configs/env.config';

let configured = false;

export function ensureAvailabilityEventPlatform(): void {
  if (configured) return;
  const eventBusName = env.EVENT_BUS_NAME.trim();
  if (!eventBusName) throw new Error('EVENT_BUS_NAME is required to publish availability readiness facts');
  configureEventPlatform({
    publishers: {
      eventbridge: new EventBridgeAdapter({
        eventBusName,
        source: 'availability-service',
      }),
    },
    payloadSchemas: {
      [BOOKING_READINESS_FACT_EVENT_TYPE]: {
        [BOOKING_READINESS_FACT_EVENT_VERSION]: BookingReadinessFactUpdatedEvent,
      },
    },
  });
  configured = true;
}
