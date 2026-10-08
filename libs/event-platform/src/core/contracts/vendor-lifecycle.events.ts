import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const VENDOR_APPROVED_EVENT_TYPE = 'VendorApproved' as const;
export const VENDOR_REJECTED_EVENT_TYPE = 'VendorRejected' as const;
export const VENDOR_SUSPENDED_EVENT_TYPE = 'VendorSuspended' as const;

export type VendorLifecycleEventType =
  | typeof VENDOR_APPROVED_EVENT_TYPE
  | typeof VENDOR_REJECTED_EVENT_TYPE
  | typeof VENDOR_SUSPENDED_EVENT_TYPE;

export const VENDOR_LIFECYCLE_EVENT_VERSION = '1.0.0' as const;
export const VENDOR_LIFECYCLE_EVENT_SOURCE = 'vendor-service' as const;

export const VENDOR_LIFECYCLE_EVENT_OPERATIONS = {
  STREAM_PUBLISH: 'vendor.lifecycle.processed',
} as const;

function lifecyclePayloadSchema() {
  return z
    .object({
      vendorId: z.string().min(1),
      previousStatus: z.string().min(1),
      newStatus: z.string().min(1),
      actorUserId: z.string().min(1),
      reason: z.string().min(1).optional(),
      reviewedAt: z.string().datetime(),
      onboardingStatus: z.string().min(1),
      /** Application user id of the vendor owner. Not a Cognito username. */
      ownerUserId: z.string().min(1).optional(),
    })
    .strict();
}

export const VendorLifecyclePayloadSchema = lifecyclePayloadSchema();

export type VendorLifecyclePayload = z.infer<typeof VendorLifecyclePayloadSchema>;

export const VendorApprovedEvent = defineEvent(lifecyclePayloadSchema(), {
  eventType: VENDOR_APPROVED_EVENT_TYPE,
  eventVersion: VENDOR_LIFECYCLE_EVENT_VERSION,
  source: VENDOR_LIFECYCLE_EVENT_SOURCE,
  transport: 'eventbridge',
});

export const VendorRejectedEvent = defineEvent(lifecyclePayloadSchema(), {
  eventType: VENDOR_REJECTED_EVENT_TYPE,
  eventVersion: VENDOR_LIFECYCLE_EVENT_VERSION,
  source: VENDOR_LIFECYCLE_EVENT_SOURCE,
  transport: 'eventbridge',
});

/** Vendor left ACTIVE. Identity drops VENDOR and keeps CUSTOMER. */
export const VendorSuspendedEvent = defineEvent(lifecyclePayloadSchema(), {
  eventType: VENDOR_SUSPENDED_EVENT_TYPE,
  eventVersion: VENDOR_LIFECYCLE_EVENT_VERSION,
  source: VENDOR_LIFECYCLE_EVENT_SOURCE,
  transport: 'eventbridge',
});

export function vendorLifecycleIdempotencyKey(
  eventType: VendorLifecycleEventType,
  vendorId: string,
  reviewedAt: string,
): string {
  return `${eventType}:${vendorId}:${reviewedAt}`;
}

registerEventDefinition({
  eventType: VENDOR_APPROVED_EVENT_TYPE,
  eventVersion: VENDOR_LIFECYCLE_EVENT_VERSION,
  source: VENDOR_LIFECYCLE_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'vendor',
  compatibility: 'strict',
});

registerEventDefinition({
  eventType: VENDOR_REJECTED_EVENT_TYPE,
  eventVersion: VENDOR_LIFECYCLE_EVENT_VERSION,
  source: VENDOR_LIFECYCLE_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'vendor',
  compatibility: 'strict',
});

registerEventDefinition({
  eventType: VENDOR_SUSPENDED_EVENT_TYPE,
  eventVersion: VENDOR_LIFECYCLE_EVENT_VERSION,
  source: VENDOR_LIFECYCLE_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'vendor',
  compatibility: 'strict',
});
