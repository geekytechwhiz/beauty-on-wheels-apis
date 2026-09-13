import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const VENDOR_EMAIL_VERIFICATION_EVENT_TYPE =
  'VendorEmailVerification.Requested' as const;
export const VENDOR_EMAIL_VERIFICATION_EVENT_VERSION = '1.0.0' as const;
export const VENDOR_EMAIL_VERIFICATION_EVENT_SOURCE = 'vendor-service' as const;

/** Middleware / logs `operation` — must end with `.processed`. */
export const VENDOR_EMAIL_VERIFICATION_EVENT_OPERATIONS = {
  STREAM_PUBLISH: 'vendor.email.verification.requested.processed',
  EMAIL_CONSUME: 'email.vendor.email.verification.requested.processed',
} as const;

export const VendorEmailVerificationRequestedPayloadSchema = z
  .object({
    vendorId: z.string().min(1),
    ownerUserId: z.string().min(1),
    email: z.string().email(),
    firstName: z.string().min(1),
    otp: z.string().min(1),
    expiryMinutes: z.number().int().positive(),
    vendorStatus: z.literal('ACTIVE'),
    applicationId: z.string().min(1).optional(),
  })
  .strict();

export type VendorEmailVerificationRequestedPayload = z.infer<
  typeof VendorEmailVerificationRequestedPayloadSchema
>;

export const VendorEmailVerificationRequestedEvent = defineEvent(
  VendorEmailVerificationRequestedPayloadSchema,
  {
    eventType: VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
    eventVersion: VENDOR_EMAIL_VERIFICATION_EVENT_VERSION,
    source: VENDOR_EMAIL_VERIFICATION_EVENT_SOURCE,
    transport: 'eventbridge',
  },
);

export function vendorEmailVerificationRequestedIdempotencyKey(
  vendorId: string,
  requestedAt?: string,
): string {
  return requestedAt
    ? `${VENDOR_EMAIL_VERIFICATION_EVENT_TYPE}:${vendorId}:${requestedAt}`
    : `${VENDOR_EMAIL_VERIFICATION_EVENT_TYPE}:${vendorId}`;
}

registerEventDefinition({
  eventType: VENDOR_EMAIL_VERIFICATION_EVENT_TYPE,
  eventVersion: VENDOR_EMAIL_VERIFICATION_EVENT_VERSION,
  source: VENDOR_EMAIL_VERIFICATION_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'vendor',
  compatibility: 'strict',
});
