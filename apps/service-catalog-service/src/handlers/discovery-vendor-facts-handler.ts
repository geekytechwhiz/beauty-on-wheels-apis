import {
  createDefaultSqsDlqStrategy,
  onEvent,
  VendorDiscoveryChangedEvent,
  VENDOR_DISCOVERY_CHANGED_EVENT_OPERATIONS,
  type EventConsumerDeps,
  type VendorDiscoveryChangedPayload,
} from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { getServicesService } from '../services/services.service';

const logger = createLogger({
  service: 'service-catalog-discovery-facts',
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

export function createDiscoveryVendorFactsHandler() {
  return onEvent({
    operation: VENDOR_DISCOVERY_CHANGED_EVENT_OPERATIONS.CATALOG_CONSUME,
    consumer: consumerDeps(),
    events: [
      {
        schema: VendorDiscoveryChangedEvent,
        handler: async ({ meta, ...payload }) => {
          const change = payload as VendorDiscoveryChangedPayload;
          await getServicesService().syncDiscoveryFromVendor(change.vendorId);
          logger.info({
            event: 'discovery_vendor_facts_consumed',
            vendorId: change.vendorId,
            subject: change.subject,
            correlationId: meta.correlationId,
          });
        },
      },
    ],
  });
}

export const handler = createDiscoveryVendorFactsHandler();
