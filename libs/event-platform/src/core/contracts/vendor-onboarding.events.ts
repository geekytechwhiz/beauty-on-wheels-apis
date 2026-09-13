import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const VENDOR_ONBOARDING_EVENT_TYPE = 'VendorOnboarding.Submitted' as const;
export const VENDOR_ONBOARDING_EVENT_VERSION = '1.0.0' as const;
export const VENDOR_ONBOARDING_EVENT_SOURCE = 'vendor-service' as const;

/** Middleware / logs `operation` — must end with `.processed`. */
export const VENDOR_ONBOARDING_EVENT_OPERATIONS = {
  STREAM_PUBLISH: 'vendor.onboarding.submitted.processed',
  EMAIL_CONSUME: 'email.vendor.onboarding.submitted.processed',
} as const;

export const VendorOnboardingSubmittedPayloadSchema = z.object({
  applicationId: z.string().min(1),
  vendorId: z.string().min(1),
  ownerUserId: z.string().min(1),
  email: z.string().email(),
  onboardingStatus: z.literal('PENDING_REVIEW'),
  businessName: z.string().min(1).optional(),
});

export type VendorOnboardingSubmittedPayload = z.infer<
  typeof VendorOnboardingSubmittedPayloadSchema
>;

export const VendorOnboardingSubmittedEvent = defineEvent(
  VendorOnboardingSubmittedPayloadSchema,
  {
    eventType: VENDOR_ONBOARDING_EVENT_TYPE,
    eventVersion: VENDOR_ONBOARDING_EVENT_VERSION,
    source: VENDOR_ONBOARDING_EVENT_SOURCE,
    transport: 'eventbridge',
  },
);

export function vendorOnboardingSubmittedIdempotencyKey(
  applicationId: string,
): string {
  return `${VENDOR_ONBOARDING_EVENT_TYPE}:${applicationId}`;
}

registerEventDefinition({
  eventType: VENDOR_ONBOARDING_EVENT_TYPE,
  eventVersion: VENDOR_ONBOARDING_EVENT_VERSION,
  source: VENDOR_ONBOARDING_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'vendor',
  compatibility: 'strict',
});
