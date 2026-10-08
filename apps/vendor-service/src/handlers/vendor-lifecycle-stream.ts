import {
  createDynamoStreamHandler,
  publishEvent,
  VendorApprovedEvent,
  VendorRejectedEvent,
  VendorSuspendedEvent,
  VENDOR_LIFECYCLE_EVENT_OPERATIONS,
  vendorLifecycleIdempotencyKey,
  type EventConsumerDeps,
  type VendorLifecyclePayload,
} from '@api-hub/event-platform';

import { ensureVendorEventPlatform } from '../events/configure-vendor-event-platform';
import { mapVendorLifecycleStreamRecord } from '../events/map-vendor-lifecycle-stream';

async function publishLifecycleEvent(
  schema:
    | typeof VendorApprovedEvent
    | typeof VendorRejectedEvent
    | typeof VendorSuspendedEvent,
  payload: VendorLifecyclePayload,
  correlationId: string,
): Promise<void> {
  ensureVendorEventPlatform();
  await publishEvent(schema, payload, {
    idempotencyKey: vendorLifecycleIdempotencyKey(
      schema.__meta.eventType as
        | 'VendorApproved'
        | 'VendorRejected'
        | 'VendorSuspended',
      payload.vendorId,
      payload.reviewedAt,
    ),
    meta: { correlationId },
  });
}

export function createVendorLifecycleStreamHandler(deps?: {
  consumer?: Partial<EventConsumerDeps>;
}) {
  return createDynamoStreamHandler({
    operation: VENDOR_LIFECYCLE_EVENT_OPERATIONS.STREAM_PUBLISH,
    consumer: {
      ...deps?.consumer,
      mapRawToBaseEvent: mapVendorLifecycleStreamRecord,
    },
    events: [
      {
        table: 'vendor',
        eventName: ['MODIFY'],
        schema: VendorApprovedEvent,
        handler: async (event) => {
          const { meta, ...payload } = event;
          await publishLifecycleEvent(
            VendorApprovedEvent,
            payload as VendorLifecyclePayload,
            meta.correlationId,
          );
        },
      },
      {
        table: 'vendor',
        eventName: ['MODIFY'],
        schema: VendorRejectedEvent,
        handler: async (event) => {
          const { meta, ...payload } = event;
          await publishLifecycleEvent(
            VendorRejectedEvent,
            payload as VendorLifecyclePayload,
            meta.correlationId,
          );
        },
      },
      {
        table: 'vendor',
        eventName: ['MODIFY'],
        schema: VendorSuspendedEvent,
        handler: async (event) => {
          const { meta, ...payload } = event;
          await publishLifecycleEvent(
            VendorSuspendedEvent,
            payload as VendorLifecyclePayload,
            meta.correlationId,
          );
        },
      },
    ],
  });
}

export const handler = createVendorLifecycleStreamHandler();
