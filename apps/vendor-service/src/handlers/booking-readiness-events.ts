import {
  BookingReadinessFactUpdatedEvent,
  BookingReadinessFactUpdatedPayloadSchema,
  createDefaultSqsDlqStrategy,
  onQueue,
  type EventConsumerDeps,
} from '@api-hub/event-platform';
import { createChildLogger, createLogger } from '@api-hub/observability';

import { getBookingReadinessService } from '../services/booking-readiness.service';

const logger = createChildLogger(createLogger({ service: 'vendor-service', redactPII: true }), { service: 'BookingReadinessProjector' });

export function createBookingReadinessEventsHandler(deps?: { consumer?: Partial<EventConsumerDeps> }) {
  const strategy = createDefaultSqsDlqStrategy();
  return onQueue({
    operation: 'vendor.bookingReadiness.event.processed',
    consumer: {
      retry: { maxAttempts: 3, strategy: 'exponential', delayMs: 200 },
      dlq: strategy ? { enabled: true, strategy } : { enabled: false },
      ...deps?.consumer,
    },
    events: [{
      schema: BookingReadinessFactUpdatedEvent,
      handler: async (event) => {
        const { meta, ...rest } = event;
        const payload = BookingReadinessFactUpdatedPayloadSchema.parse(rest);
        logger.info({
          event: 'booking_readiness_event_received',
          eventId: payload.eventId,
          eventType: BookingReadinessFactUpdatedEvent.__meta.eventType,
          source: payload.source,
          vendorId: payload.vendorId,
          aggregateVersion: payload.aggregateVersion,
          correlationId: meta.correlationId,
        });
        await getBookingReadinessService().apply(payload);
      },
    }],
  });
}

export const handler = createBookingReadinessEventsHandler();
