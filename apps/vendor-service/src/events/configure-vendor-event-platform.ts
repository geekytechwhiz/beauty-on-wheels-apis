import {
  configureEventPlatform,
  EventBridgeAdapter,
  VendorEmailVerificationRequestedEvent,
  VendorOnboardingSubmittedEvent,
  VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
  VENDOR_EMAIL_VERIFICATION_EVENT_VERSION,
  VENDOR_ONBOARDING_EVENT_TYPE,
  VENDOR_ONBOARDING_EVENT_VERSION,
} from '@api-hub/event-platform';

import { env } from '../configs/env.config';

let configured = false;

export function ensureVendorEventPlatform(): void {
  if (configured) {
    return;
  }

  const eventBusName = env.EVENT_BUS_NAME?.trim();
  if (!eventBusName) {
    throw new Error('EVENT_BUS_NAME is required to publish vendor events');
  }

  configureEventPlatform({
    publishers: {
      eventbridge: new EventBridgeAdapter({
        eventBusName,
        source: 'vendor-service',
      }),
    },
    payloadSchemas: {
      [VENDOR_ONBOARDING_EVENT_TYPE]: {
        [VENDOR_ONBOARDING_EVENT_VERSION]: VendorOnboardingSubmittedEvent,
      },
      [VENDOR_EMAIL_VERIFICATION_EVENT_TYPE]: {
        [VENDOR_EMAIL_VERIFICATION_EVENT_VERSION]:
          VendorEmailVerificationRequestedEvent,
      },
    },
  });

  configured = true;
}

export function resetVendorEventPlatformForTests(): void {
  configured = false;
}
