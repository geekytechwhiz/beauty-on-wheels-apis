import {
  createDynamoStreamHandler,
  VendorEmailVerificationRequestedEvent,
  VENDOR_EMAIL_VERIFICATION_EVENT_OPERATIONS,
  type EventConsumerDeps,
  type VendorEmailVerificationRequestedPayload,
} from '@api-hub/event-platform';
import { getLogger } from '@api-hub/observability';

import {
  markVendorEmailVerificationDispatched,
  publishVendorEmailVerificationRequested,
} from '../events/publish-vendor-email-verification';
import { mapVendorEmailVerificationRequestedStreamRecord } from '../events/map-vendor-email-verification-requested-stream';

export type PublishVendorEmailVerificationRequested = (
  payload: VendorEmailVerificationRequestedPayload,
  correlationId: string,
) => Promise<void>;

export function createVendorEmailVerificationRequestedStreamHandler(deps?: {
  publish?: PublishVendorEmailVerificationRequested;
  markDispatched?: (vendorId: string, verificationRequestId: string) => Promise<void>;
  consumer?: Partial<EventConsumerDeps>;
}) {
  const publish = deps?.publish ?? publishVendorEmailVerificationRequested;
  // Custom publishers are used by unit tests and own their acknowledgement.
  const markDispatched = deps?.markDispatched ?? (deps?.publish
    ? async () => undefined
    : markVendorEmailVerificationDispatched);

  return createDynamoStreamHandler({
    operation: VENDOR_EMAIL_VERIFICATION_EVENT_OPERATIONS.STREAM_PUBLISH,
    consumer: {
      ...deps?.consumer,
      mapRawToBaseEvent: mapVendorEmailVerificationRequestedStreamRecord,
    },
    events: [
      {
        table: 'vendor',
        eventName: ['MODIFY'],
        schema: VendorEmailVerificationRequestedEvent,
        handler: async (event) => {
          const { meta, ...payload } = event;
          const requestPayload = payload as VendorEmailVerificationRequestedPayload & {
            verificationRequestId: string;
          };
          const fields = {
            vendorId: requestPayload.vendorId,
            eventName: VendorEmailVerificationRequestedEvent.__meta.eventType,
            eventId: event.eventId,
            correlationId: meta.correlationId,
          };
          getLogger().info('vendor_email_event_publish_started', fields);
          try {
            await publish(requestPayload, meta.correlationId);
            await markDispatched(requestPayload.vendorId, requestPayload.verificationRequestId);
            getLogger().info('vendor_email_event_publish_succeeded', fields);
          } catch (error) {
            getLogger().error('vendor_email_event_publish_failed', error, fields);
            throw error;
          }
        },
      },
    ],
  });
}

export const handler = createVendorEmailVerificationRequestedStreamHandler();
