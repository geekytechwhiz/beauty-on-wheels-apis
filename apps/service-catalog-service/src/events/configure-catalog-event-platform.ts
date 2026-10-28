import {
  configureEventPlatform,
  EventBridgeAdapter,
  SERVICE_VISIT_EVENT_TYPES,
  SERVICE_VISIT_EVENT_VERSION,
  ServiceVisitActivatedEvent,
  ServiceVisitArchivedEvent,
  ServiceVisitCreatedEvent,
  ServiceVisitPausedEvent,
  ServiceVisitUpdatedEvent,
  VendorServiceChangedEvent,
  VENDOR_SERVICE_EVENT_TYPES,
  VENDOR_SERVICE_EVENT_VERSION,
  BookingReadinessFactUpdatedEvent,
  BOOKING_READINESS_FACT_EVENT_TYPE,
  BOOKING_READINESS_FACT_EVENT_VERSION,
} from '@api-hub/event-platform';

import { env } from '../configs/env.config';

let configured = false;

export function ensureCatalogEventPlatform(): void {
  if (configured) {
    return;
  }
  const eventBusName = env.EVENT_BUS_NAME?.trim();
  if (!eventBusName) {
    throw new Error('EVENT_BUS_NAME is required to publish service visit events');
  }
  configureEventPlatform({
    publishers: {
      eventbridge: new EventBridgeAdapter({
        eventBusName,
        source: 'service-catalog-service',
      }),
    },
    payloadSchemas: {
      [SERVICE_VISIT_EVENT_TYPES.CREATED]: { [SERVICE_VISIT_EVENT_VERSION]: ServiceVisitCreatedEvent },
      [SERVICE_VISIT_EVENT_TYPES.UPDATED]: { [SERVICE_VISIT_EVENT_VERSION]: ServiceVisitUpdatedEvent },
      [SERVICE_VISIT_EVENT_TYPES.ACTIVATED]: { [SERVICE_VISIT_EVENT_VERSION]: ServiceVisitActivatedEvent },
      [SERVICE_VISIT_EVENT_TYPES.PAUSED]: { [SERVICE_VISIT_EVENT_VERSION]: ServiceVisitPausedEvent },
      [SERVICE_VISIT_EVENT_TYPES.ARCHIVED]: { [SERVICE_VISIT_EVENT_VERSION]: ServiceVisitArchivedEvent },
      [VENDOR_SERVICE_EVENT_TYPES.CHANGED]: { [VENDOR_SERVICE_EVENT_VERSION]: VendorServiceChangedEvent },
      [BOOKING_READINESS_FACT_EVENT_TYPE]: { [BOOKING_READINESS_FACT_EVENT_VERSION]: BookingReadinessFactUpdatedEvent },
    },
  });
  configured = true;
}
