import {
  BookingConfirmedEvent,
  BOOKING_CONFIRMED_EVENT_TYPE,
  BOOKING_CONFIRMED_EVENT_VERSION,
  configureEventPlatform,
  EventBridgeAdapter,
} from '@api-hub/event-platform';

import { env } from '../configs/env.config';

let configured = false;

export function ensureBookingEventPlatform(): void {
  if (configured) return;
  const eventBusName = env.EVENT_BUS_NAME.trim();
  if (!eventBusName) throw new Error('EVENT_BUS_NAME is required to publish booking events');
  configureEventPlatform({
    publishers: {
      eventbridge: new EventBridgeAdapter({ eventBusName, source: 'booking-service' }),
    },
    payloadSchemas: {
      [BOOKING_CONFIRMED_EVENT_TYPE]: {
        [BOOKING_CONFIRMED_EVENT_VERSION]: BookingConfirmedEvent,
      },
    },
  });
  configured = true;
}
