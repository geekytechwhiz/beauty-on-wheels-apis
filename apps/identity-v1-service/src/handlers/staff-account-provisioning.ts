import { onEvent, publishEvent, StaffAccountProvisioningRequestedEvent, StaffAccountProvisionedEvent, staffAccountProvisionedIdempotencyKey, type StaffAccountProvisioningRequestedPayload } from '@api-hub/event-platform';
import { ensureIdentityEventPlatform } from '../events/configure-identity-event-platform';
import { StaffAccountProvisioningService } from '../services/staff-account-provisioning.service';

export function createStaffAccountProvisioningHandler(service = new StaffAccountProvisioningService()) {
  return onEvent({ operation: 'identity.staff.account.provisioning.processed', events: [{ schema: StaffAccountProvisioningRequestedEvent, handler: async ({ meta, ...payload }) => {
    const request = payload as StaffAccountProvisioningRequestedPayload;
    const result = await service.ensure(request);
    ensureIdentityEventPlatform();
    await publishEvent(StaffAccountProvisionedEvent, { vendorId: request.vendorId, staffId: request.staffId, ...result, status: 'COMPLETED' }, { idempotencyKey: staffAccountProvisionedIdempotencyKey(request.vendorId, request.staffId, result.identityId), meta: { correlationId: meta.correlationId, causationId: meta.causationId } });
  }}] });
}
export const handler = createStaffAccountProvisioningHandler();
