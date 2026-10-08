import {
  createDynamoStreamHandler,
  VendorEmailVerificationRequestedEvent,
  VENDOR_EMAIL_VERIFICATION_EVENT_OPERATIONS,
  type EventConsumerDeps,
  type VendorEmailVerificationRequestedPayload,
} from '@api-hub/event-platform';

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
          await publish(
            payload as VendorEmailVerificationRequestedPayload,
            meta.correlationId,
          );
          const requestPayload = payload as VendorEmailVerificationRequestedPayload & {
            verificationRequestId: string;
          };
          await markDispatched(requestPayload.vendorId, requestPayload.verificationRequestId);
        },
      },
    ],
  });
}

export const handler = createVendorEmailVerificationRequestedStreamHandler();
