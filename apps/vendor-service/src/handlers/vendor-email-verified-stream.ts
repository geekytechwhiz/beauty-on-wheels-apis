import {
  createDynamoStreamHandler,
  publishEvent,
  VendorEmailVerifiedEvent,
  vendorEmailVerifiedIdempotencyKey,
  type VendorEmailVerifiedPayload,
} from '@api-hub/event-platform';

import { ensureVendorEventPlatform } from '../events/configure-vendor-event-platform';
import { mapVendorEmailVerifiedStreamRecord } from '../events/map-vendor-email-verified-stream';

async function publishVendorEmailVerified(
  payload: VendorEmailVerifiedPayload,
  correlationId: string,
  verifiedAt: string,
): Promise<void> {
  ensureVendorEventPlatform();
  await publishEvent(VendorEmailVerifiedEvent, payload, {
    idempotencyKey: vendorEmailVerifiedIdempotencyKey(payload.vendorId, verifiedAt),
    meta: { correlationId },
  });
}

export function createVendorEmailVerifiedStreamHandler() {
  return createDynamoStreamHandler({
    operation: 'vendor.email.verified.processed',
    consumer: { mapRawToBaseEvent: mapVendorEmailVerifiedStreamRecord },
    events: [
      {
        table: 'vendor',
        eventName: ['MODIFY'],
        schema: VendorEmailVerifiedEvent,
        handler: async ({ meta, ...payload }) => {
          await publishVendorEmailVerified(
            payload as VendorEmailVerifiedPayload,
            meta.correlationId,
            meta.publishedAt ?? new Date().toISOString(),
          );
        },
      },
    ],
  });
}

export const handler = createVendorEmailVerifiedStreamHandler();
