import {
  createDynamoStreamHandler,
  publishEvent,
  VendorEmailVerificationRequestedEvent,
  VENDOR_EMAIL_VERIFICATION_EVENT_OPERATIONS,
  vendorEmailVerificationRequestedIdempotencyKey,
  type EventConsumerDeps,
  type VendorEmailVerificationRequestedPayload,
} from '@api-hub/event-platform';

import { ensureVendorEventPlatform } from '../events/configure-vendor-event-platform';
import { mapVendorEmailVerificationRequestedStreamRecord } from '../events/map-vendor-email-verification-requested-stream';

export type PublishVendorEmailVerificationRequested = (
  payload: VendorEmailVerificationRequestedPayload,
  correlationId: string,
) => Promise<void>;

async function publishVendorEmailVerificationRequested(
  payload: VendorEmailVerificationRequestedPayload,
  correlationId: string,
): Promise<void> {
  ensureVendorEventPlatform();
  await publishEvent(VendorEmailVerificationRequestedEvent, payload, {
    idempotencyKey: vendorEmailVerificationRequestedIdempotencyKey(
      payload.vendorId,
    ),
    meta: { correlationId },
  });
}

export function createVendorEmailVerificationRequestedStreamHandler(deps?: {
  publish?: PublishVendorEmailVerificationRequested;
  consumer?: Partial<EventConsumerDeps>;
}) {
  const publish = deps?.publish ?? publishVendorEmailVerificationRequested;

  return createDynamoStreamHandler({
    operation: VENDOR_EMAIL_VERIFICATION_EVENT_OPERATIONS.STREAM_PUBLISH,
    consumer: {
      ...deps?.consumer,
      mapRawToBaseEvent: mapVendorEmailVerificationRequestedStreamRecord,
    },
    events: [
      {
        table: 'vendor',
        eventName: ['MODIFY'],
        schema: VendorEmailVerificationRequestedEvent,
        handler: async (event) => {
          const { meta, ...payload } = event;
          await publish(
            payload as VendorEmailVerificationRequestedPayload,
            meta.correlationId,
          );
        },
      },
    ],
  });
}

export const main = createVendorEmailVerificationRequestedStreamHandler();
