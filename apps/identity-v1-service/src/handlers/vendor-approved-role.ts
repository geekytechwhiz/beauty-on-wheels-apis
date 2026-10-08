import {
  createDefaultSqsDlqStrategy,
  onEvent,
  VendorApprovedEvent,
  type EventConsumerDeps,
} from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { applyVendorApprovalRole } from '../auth/vendor-approval-role';
import { identityRepositoryInstance } from '../repositories/identity.repository';

const logger = createLogger({
  service: 'identity-vendor-approved-role',
  redactPII: true,
});

function consumerDeps(): Partial<EventConsumerDeps> {
  const strategy = createDefaultSqsDlqStrategy();
  return {
    retry: {
      maxAttempts: 3,
      strategy: 'exponential',
      delayMs: 200,
    },
    dlq: strategy ? { enabled: true, strategy } : { enabled: false },
  };
}

export function createVendorApprovedRoleHandler() {
  return onEvent({
    operation: 'identity.vendor-role.processed',
    consumer: consumerDeps(),
    events: [
      {
        schema: VendorApprovedEvent,
        handler: async ({ meta: _meta, ...payload }: any) => {
          const result = await applyVendorApprovalRole(
            {
              newStatus: payload.newStatus,
              ownerUserId: payload.ownerUserId,
              onboardingStatus: payload.onboardingStatus,
            },
            identityRepositoryInstance,
          );
          logger.info({
            event: 'vendor_application_role',
            result,
            vendorId: payload.vendorId,
          });
        },
      },
    ],
  });
}

export const handler = createVendorApprovedRoleHandler();
