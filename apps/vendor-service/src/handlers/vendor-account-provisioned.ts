import {
  onEvent,
  VendorAccountProvisionedEvent,
  type VendorAccountProvisionedPayload,
} from '@api-hub/event-platform';
import { ConditionalWriteConflictError } from '@api-hub/utils';
import { getLogger } from '@api-hub/observability';

import { OwnerMapper } from '../mappers/owner.mapper';
import { VendorsRepository } from '../repositories/vendors.repository';

/**
 * Completes vendor ↔ identity linkage after Identity finishes Cognito/user/role work.
 * Account provisioning "COMPLETED" means: identityId + ownerUserId linked and
 * VENDOR role was assigned by Identity. Email verification is tracked separately.
 */
export function createVendorAccountProvisionedHandler(
  repository = new VendorsRepository(),
) {
  return onEvent({
    operation: 'vendor.account.provisioned.processed',
    events: [
      {
        schema: VendorAccountProvisionedEvent,
        handler: async ({ ...payload }) => {
          const event = payload as VendorAccountProvisionedPayload;
          const vendor = await repository.getVendorById(event.vendorId);
          if (!vendor) {
            getLogger().info('vendor_account_provisioned_skipped_missing', {
              vendorId: event.vendorId,
              operation: 'vendor.account.linkage',
              outcome: 'skipped',
            });
            return;
          }

          if (vendor.identityId && vendor.identityId !== event.identityId) {
            throw new Error('Vendor identity link conflict');
          }

          if (
            vendor.ownerUserId &&
            vendor.ownerUserId !== event.userId
          ) {
            throw new Error('Vendor owner user link conflict');
          }

          const timestamp = new Date().toISOString();
          const alreadyComplete =
            vendor.accountProvisioningStatus === 'COMPLETED' &&
            vendor.identityId === event.identityId &&
            vendor.ownerUserId === event.userId;

          if (!alreadyComplete) {
            await repository.updateVendor({
              ...vendor,
              identityId: event.identityId,
              ownerUserId: event.userId,
              accountProvisioningStatus: 'COMPLETED',
              accountProvisionedAt: timestamp,
              accountProvisioningFailure: undefined,
              updatedAt: timestamp,
            });
          }

          // Partner login resolves vendors via VendorOwner GSI1 + ownership lock.
          try {
            await repository.putIfAbsent(
              OwnerMapper.initialOwner(event.vendorId, event.userId) as unknown as Record<
                string,
                unknown
              >,
            );
          } catch (error) {
            if (!(error instanceof ConditionalWriteConflictError)) {
              throw error;
            }
          }

          try {
            await repository.putOwnershipIfAbsent(
              OwnerMapper.ownershipClaim(event.vendorId, event.userId),
            );
          } catch (error) {
            if (!(error instanceof ConditionalWriteConflictError)) {
              throw error;
            }
          }

          getLogger().info('vendor_account_linkage_completed', {
            vendorId: event.vendorId,
            correlationId: (payload as { meta?: { correlationId?: string } }).meta
              ?.correlationId,
            operation: 'vendor.account.linkage',
            outcome: 'completed',
          });
        },
      },
    ],
  });
}

export const handler = createVendorAccountProvisionedHandler();
