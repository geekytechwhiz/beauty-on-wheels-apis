import {
  createDefaultSqsDlqStrategy,
  onEvent,
  VendorApprovedEvent,
  VendorRejectedEvent,
  VendorSuspendedEvent,
  type EventConsumerDeps,
  type VendorLifecyclePayload,
} from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { getServicesService } from '../services/services.service';

const logger = createLogger({
  service: 'service-catalog-discovery-lifecycle',
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

async function applyLifecycle(
  payload: VendorLifecyclePayload,
  correlationId: string,
): Promise<void> {
  await getServicesService().applyVendorLifecycle({
    vendorId: payload.vendorId,
    newStatus: payload.newStatus,
    reviewedAt: payload.reviewedAt,
  });
  logger.info({
    event: 'discovery_vendor_lifecycle_consumed',
    vendorId: payload.vendorId,
    correlationId,
  });
}

export function createDiscoveryVendorLifecycleHandler() {
  return onEvent({
    operation: 'catalog.discovery.processed',
    consumer: consumerDeps(),
    events: [
      {
        schema: VendorApprovedEvent,
        handler: async ({ meta, ...payload }) => {
          await applyLifecycle(payload as VendorLifecyclePayload, meta.correlationId);
        },
      },
      {
        schema: VendorRejectedEvent,
        handler: async ({ meta, ...payload }) => {
          await applyLifecycle(payload as VendorLifecyclePayload, meta.correlationId);
        },
      },
      {
        schema: VendorSuspendedEvent,
        handler: async ({ meta, ...payload }) => {
          await applyLifecycle(payload as VendorLifecyclePayload, meta.correlationId);
        },
      },
    ],
  });
}

export const handler = createDiscoveryVendorLifecycleHandler();
