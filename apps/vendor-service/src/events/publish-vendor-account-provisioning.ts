import {
  publishEvent,
  VendorAccountProvisioningRequestedEvent,
  vendorAccountProvisioningIdempotencyKey,
  type VendorAccountProvisioningRequestedPayload,
} from '@api-hub/event-platform';

import { ensureVendorEventPlatform } from './configure-vendor-event-platform';

export async function publishVendorAccountProvisioningRequested(
  payload: VendorAccountProvisioningRequestedPayload,
  correlationId: string,
): Promise<void> {
  ensureVendorEventPlatform();
  await publishEvent(VendorAccountProvisioningRequestedEvent, payload, {
    idempotencyKey: vendorAccountProvisioningIdempotencyKey(payload.vendorId),
    meta: { correlationId },
  });
}
