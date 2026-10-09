import {
  createDefaultSqsDlqStrategy,
  onEvent,
  VendorEmailVerifiedEvent,
  type EventConsumerDeps,
  type VendorEmailVerifiedPayload,
} from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { applyVendorEmailVerifiedRole } from '../auth/vendor-email-verified-role';
import { identityRepositoryInstance } from '../repositories/identity.repository';

const logger = createLogger({
  service: 'identity-vendor-email-verified-role',
  redactPII: true,
});

function consumerDeps(): Partial<EventConsumerDeps> {
  const strategy = createDefaultSqsDlqStrategy();
  return {
    retry: { maxAttempts: 3, strategy: 'exponential', delayMs: 200 },
    dlq: strategy ? { enabled: true, strategy } : { enabled: false },
  };
}

export function createVendorEmailVerifiedRoleHandler() {
  return onEvent({
    operation: 'identity.vendor.email-verified.processed',
    consumer: consumerDeps(),
    events: [
      {
        schema: VendorEmailVerifiedEvent,
        handler: async ({ meta, ...payload }) => {
          const event = payload as VendorEmailVerifiedPayload;
          const result = await applyVendorEmailVerifiedRole(event, identityRepositoryInstance);
          logger.info({
            event: 'vendor_email_verified_role_processed',
            result,
            userId: event.userId,
            vendorId: event.vendorId,
            correlationId: meta.correlationId,
          });
        },
      },
    ],
  });
}

export const handler = createVendorEmailVerifiedRoleHandler();
