import { createDynamoStreamHandler, publishEvent, VendorServiceChangedEvent, vendorServiceIdempotencyKey, type EventConsumerDeps, type VendorServiceSnapshot } from '@api-hub/event-platform';

import { ensureCatalogEventPlatform } from '../events/configure-catalog-event-platform';
import { publishCatalogBookingReadiness } from '../events/publish-booking-readiness';
import { mapVendorServiceStreamRecord } from '../events/map-vendor-service-stream';

export function createVendorServiceStreamHandler(deps?: { consumer?: Partial<EventConsumerDeps> }) {
  return createDynamoStreamHandler({
    operation: 'catalog.vendorService.processed',
    consumer: { ...deps?.consumer, mapRawToBaseEvent: mapVendorServiceStreamRecord },
    events: [{
      table: 'service-catalog', eventName: ['INSERT', 'MODIFY', 'REMOVE'], schema: VendorServiceChangedEvent,
      handler: async (event) => {
        const { meta, ...payload } = event as VendorServiceSnapshot & { meta: { correlationId: string } };
        ensureCatalogEventPlatform();
        await publishEvent(VendorServiceChangedEvent, payload, { idempotencyKey: vendorServiceIdempotencyKey(payload.serviceId, payload.version, payload.deleted), meta: { correlationId: meta.correlationId } });
        await publishCatalogBookingReadiness({
          vendorId: payload.vendorId,
          correlationId: meta.correlationId,
          trigger: payload.deleted ? 'deleted' : payload.active ? 'enabled' : 'disabled',
          changed: { serviceId: payload.serviceId, active: payload.active, deleted: payload.deleted },
        });
      },
    }],
  });
}

export const handler = createVendorServiceStreamHandler();
