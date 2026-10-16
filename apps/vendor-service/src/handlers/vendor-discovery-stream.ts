import {
  createDynamoStreamHandler,
  publishEvent,
  VendorDiscoveryChangedEvent,
  VENDOR_DISCOVERY_CHANGED_EVENT_OPERATIONS,
  vendorDiscoveryChangedIdempotencyKey,
  type EventConsumerDeps,
  type VendorDiscoveryChangedPayload,
} from '@api-hub/event-platform';

import { ensureVendorEventPlatform } from '../events/configure-vendor-event-platform';
import { mapVendorDiscoveryStreamRecord } from '../events/map-vendor-discovery-stream';

async function publishDiscoveryChanged(
  payload: VendorDiscoveryChangedPayload,
  eventId: string,
  correlationId: string,
): Promise<void> {
  ensureVendorEventPlatform();
  await publishEvent(VendorDiscoveryChangedEvent, payload, {
    idempotencyKey: vendorDiscoveryChangedIdempotencyKey(eventId),
    meta: { correlationId },
  });
}

export function createVendorDiscoveryStreamHandler(deps?: {
  consumer?: Partial<EventConsumerDeps>;
}) {
  return createDynamoStreamHandler({
    operation: VENDOR_DISCOVERY_CHANGED_EVENT_OPERATIONS.STREAM_PUBLISH,
    consumer: {
      ...deps?.consumer,
      mapRawToBaseEvent: mapVendorDiscoveryStreamRecord,
    },
    events: [
      {
        table: 'vendor',
        eventName: ['INSERT', 'MODIFY', 'REMOVE'],
        schema: VendorDiscoveryChangedEvent,
        handler: async (event) => {
          const { meta, ...payload } = event;
          const streamEventId = typeof meta.attributes?.streamEventId === 'string'
            ? meta.attributes.streamEventId
            : meta.correlationId;
          await publishDiscoveryChanged(
            payload as VendorDiscoveryChangedPayload,
            streamEventId,
            meta.correlationId,
          );
        },
      },
    ],
  });
}

export const handler = createVendorDiscoveryStreamHandler();
