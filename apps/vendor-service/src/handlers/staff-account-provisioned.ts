import { onEvent, StaffAccountProvisionedEvent, type StaffAccountProvisionedPayload } from '@api-hub/event-platform';
import { ConditionalWriteConflictError } from '@api-hub/utils';
import { getStaffRepository } from '../repositories/staff.repository';

/** Vendor-owned completion of an Identity-owned account workflow. */
export function createStaffAccountProvisionedHandler(repository = getStaffRepository()) {
  return onEvent({ operation: 'vendor.staff.account.provisioned.processed', events: [{ schema: StaffAccountProvisionedEvent, handler: async ({ ...payload }) => {
    const event = payload as StaffAccountProvisionedPayload;
    const staff = await repository.getStaff(event.vendorId, event.staffId);
    if (!staff || staff.status !== 'ACTIVE') return; // obsolete/deactivated intent
    if (staff.provisioningStatus === 'COMPLETED' && staff.userId === event.userId && staff.identityId === event.identityId) return;
    if (staff.provisioningStatus !== 'PENDING') throw new Error('Staff provisioning state conflict');
    try { await repository.completeProvisioning(staff, event.userId, event.identityId); }
    catch (error) { if (error instanceof ConditionalWriteConflictError) throw new Error('Staff membership already active under another vendor or changed during provisioning'); throw error; }
  }}] });
}
export const handler = createStaffAccountProvisionedHandler();
