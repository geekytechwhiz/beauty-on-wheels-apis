import {
  createDynamoStreamHandler,
  type EventConsumerDeps,
} from '@api-hub/event-platform';

import { mapVendorProfileStreamRecord } from '../events/map-vendor-profile-stream';
import { VendorProfileStreamWorkEvent } from '../events/vendor-profile-stream.work';
import {
  processVendorProfileStreamWork,
  type ProcessVendorProfileStreamDeps,
} from '../services/vendor-profile-stream/process-vendor-profile-stream';

/**
 * Single vendor-table DynamoDB stream consumer.
 *
 * Physical name remains `${resourcePrefix}-vendor-email-verification-stream`.
 * Handles PROFILE INSERT/MODIFY for:
 * - trusted vendor account provisioning requests
 * - email-verification initiation (existing EventBridge → Email Service path)
 */
export function createVendorProfileStreamHandler(
  deps?: ProcessVendorProfileStreamDeps & {
    consumer?: Partial<EventConsumerDeps>;
  },
) {
  return createDynamoStreamHandler({
    operation: 'vendor.profile.stream.processed',
    consumer: {
      ...deps?.consumer,
      mapRawToBaseEvent: mapVendorProfileStreamRecord,
    },
    events: [
      {
        table: 'vendor',
        eventName: ['INSERT', 'MODIFY'],
        schema: VendorProfileStreamWorkEvent,
        handler: async (event) => {
          const { meta, ...payload } = event;
          await processVendorProfileStreamWork(
            {
              ...(payload as Parameters<
                typeof processVendorProfileStreamWork
              >[0]),
              correlationId: meta.correlationId,
            },
            {
              publishProvisioning: deps?.publishProvisioning,
              publishEmail: deps?.publishEmail,
              markEmailDispatched: deps?.markEmailDispatched,
            },
          );
        },
      },
    ],
  });
}

/** @deprecated Use createVendorProfileStreamHandler — retained for import stability. */
export const createVendorEmailVerificationRequestedStreamHandler =
  createVendorProfileStreamHandler;

export const handler = createVendorProfileStreamHandler();
