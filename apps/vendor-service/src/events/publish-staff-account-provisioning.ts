import { publishEvent, StaffAccountProvisioningRequestedEvent, staffAccountProvisioningIdempotencyKey, type StaffAccountProvisioningRequestedPayload } from '@api-hub/event-platform';
import { ensureVendorEventPlatform } from './configure-vendor-event-platform';

export async function publishStaffAccountProvisioningRequested(payload: StaffAccountProvisioningRequestedPayload, correlationId: string): Promise<void> {
  ensureVendorEventPlatform();
  await publishEvent(StaffAccountProvisioningRequestedEvent, payload, { idempotencyKey: staffAccountProvisioningIdempotencyKey(payload.vendorId, payload.staffId), meta: { correlationId } });
}
