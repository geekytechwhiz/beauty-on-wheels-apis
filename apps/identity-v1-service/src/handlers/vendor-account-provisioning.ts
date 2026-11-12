import {
  onEvent,
  publishEvent,
  VendorAccountProvisioningRequestedEvent,
  VendorAccountProvisionedEvent,
  vendorAccountProvisionedIdempotencyKey,
  type VendorAccountProvisioningRequestedPayload,
} from '@api-hub/event-platform';

import { ensureIdentityEventPlatform } from '../events/configure-identity-event-platform';
import { VendorAccountProvisioningService } from '../services/vendor-account-provisioning.service';

export function createVendorAccountProvisioningHandler(
  service = new VendorAccountProvisioningService(),
) {
  return onEvent({
    operation: 'identity.vendor.account.provisioning.processed',
    events: [
      {
        schema: VendorAccountProvisioningRequestedEvent,
        handler: async ({ meta, ...payload }) => {
          const request = payload as VendorAccountProvisioningRequestedPayload;
          const result = await service.ensure(request);
          ensureIdentityEventPlatform();
          await publishEvent(
            VendorAccountProvisionedEvent,
            {
              vendorId: request.vendorId,
              ...result,
              status: 'COMPLETED',
            },
            {
              idempotencyKey: vendorAccountProvisionedIdempotencyKey(
                request.vendorId,
                result.identityId,
              ),
              meta: {
                correlationId: meta.correlationId,
                causationId: meta.causationId,
              },
            },
          );
        },
      },
    ],
  });
}

export const handler = createVendorAccountProvisioningHandler();
