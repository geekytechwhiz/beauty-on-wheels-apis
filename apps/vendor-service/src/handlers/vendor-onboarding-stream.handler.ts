import {
  createDynamoStreamHandler,
  publishEvent,
  VendorOnboardingSubmittedEvent,
  VENDOR_ONBOARDING_EVENT_OPERATIONS,
  vendorOnboardingSubmittedIdempotencyKey,
  type EventConsumerDeps,
  type VendorOnboardingSubmittedPayload,
} from '@api-hub/event-platform';

import { ensureVendorEventPlatform } from '../events/configure-vendor-event-platform';
import { mapVendorOnboardingSubmittedStreamRecord } from '../events/map-vendor-onboarding-submitted-stream';

export type PublishVendorOnboardingSubmitted = (
  payload: VendorOnboardingSubmittedPayload,
  correlationId: string,
) => Promise<void>;

async function publishVendorOnboardingSubmitted(
  payload: VendorOnboardingSubmittedPayload,
  correlationId: string,
): Promise<void> {
  ensureVendorEventPlatform();
  await publishEvent(VendorOnboardingSubmittedEvent, payload, {
    idempotencyKey: vendorOnboardingSubmittedIdempotencyKey(payload.applicationId),
    meta: { correlationId },
  });
}

export function createVendorOnboardingSubmittedStreamHandler(deps?: {
  publish?: PublishVendorOnboardingSubmitted;
  consumer?: Partial<EventConsumerDeps>;
}) {
  const publish = deps?.publish ?? publishVendorOnboardingSubmitted;

  return createDynamoStreamHandler({
    operation: VENDOR_ONBOARDING_EVENT_OPERATIONS.STREAM_PUBLISH,
    consumer: {
      ...deps?.consumer,
      mapRawToBaseEvent: mapVendorOnboardingSubmittedStreamRecord,
    },
    events: [
      {
        table: 'vendor',
        eventName: ['MODIFY'],
        schema: VendorOnboardingSubmittedEvent,
        handler: async (event) => {
          const { meta, ...payload } = event;
          await publish(
            payload as VendorOnboardingSubmittedPayload,
            meta.correlationId,
          );
        },
      },
    ],
  });
}

export const main = createVendorOnboardingSubmittedStreamHandler();
