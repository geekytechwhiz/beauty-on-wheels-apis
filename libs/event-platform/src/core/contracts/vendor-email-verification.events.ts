import { z } from 'zod';

import { defineEvent } from '../schema/define-event';
import { registerEventDefinition } from '../../governance/event-registry';

export const VENDOR_EMAIL_VERIFICATION_EVENT_TYPE =
  'VendorEmailVerification.Requested' as const;
export const VENDOR_EMAIL_VERIFICATION_EVENT_VERSION = '1.0.0' as const;
export const VENDOR_EMAIL_VERIFICATION_EVENT_SOURCE = 'vendor-service' as const;

/**
 * Emitted only after the Vendor profile has both a completed onboarding state
 * and a consumed, verified email-verification credential.  It is deliberately
 * separate from the email-delivery request event: consumers can treat it as a
 * trusted business-state transition, rather than proof supplied by a client.
 */
export const VENDOR_EMAIL_VERIFIED_EVENT_TYPE = 'Vendor.EmailVerified' as const;
export const VENDOR_EMAIL_VERIFIED_EVENT_VERSION = '1.0.0' as const;
export const VENDOR_EMAIL_VERIFIED_EVENT_SOURCE = 'vendor-service' as const;

/** Middleware / logs `operation` — must end with `.processed`. */
export const VENDOR_EMAIL_VERIFICATION_EVENT_OPERATIONS = {
  STREAM_PUBLISH: 'vendor.email.verification.requested.processed',
  EMAIL_CONSUME: 'email.vendor.email.verification.requested.processed',
} as const;

export const VendorEmailVerificationRequestedPayloadSchema = z
  .object({
    vendorId: z.string().min(1),
    verificationRequestId: z.string().min(1),
    intent: z.literal('VENDOR_EMAIL_VERIFICATION'),
    ownerUserId: z.string().min(1),
    email: z.string().email(),
    /** Display name of the person who owns the vendor account. */
    ownerName: z.string().min(1),
    /** Authoritative name stored on the Vendor profile. */
    businessName: z.string().min(1),
    /** Opaque, single-use bearer token. Never log this value. */
    verificationToken: z.string().min(1),
    expiryMinutes: z.number().int().positive(),
    vendorStatus: z.literal('PENDING_VERIFICATION'),
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

export const VendorEmailVerifiedPayloadSchema = z
  .object({
    vendorId: z.string().min(1),
    userId: z.string().min(1),
    /** Identity is optional while older vendor profiles are backfilled. */
    identityId: z.string().min(1).optional(),
    emailVerified: z.literal(true),
  })
  .strict();

export type VendorEmailVerifiedPayload = z.infer<
  typeof VendorEmailVerifiedPayloadSchema
>;

export const VendorEmailVerifiedEvent = defineEvent(
  VendorEmailVerifiedPayloadSchema,
  {
    eventType: VENDOR_EMAIL_VERIFIED_EVENT_TYPE,
    eventVersion: VENDOR_EMAIL_VERIFIED_EVENT_VERSION,
    source: VENDOR_EMAIL_VERIFIED_EVENT_SOURCE,
    transport: 'eventbridge',
  },
);

export function vendorEmailVerificationRequestedIdempotencyKey(
  vendorId: string,
  verificationRequestId?: string,
): string {
  return verificationRequestId
    ? `${VENDOR_EMAIL_VERIFICATION_EVENT_TYPE}:${vendorId}:${verificationRequestId}`
    : `${VENDOR_EMAIL_VERIFICATION_EVENT_TYPE}:${vendorId}`;
}

export function vendorEmailVerifiedIdempotencyKey(
  vendorId: string,
  verifiedAt?: string,
): string {
  return verifiedAt
    ? `${VENDOR_EMAIL_VERIFIED_EVENT_TYPE}:${vendorId}:${verifiedAt}`
    : `${VENDOR_EMAIL_VERIFIED_EVENT_TYPE}:${vendorId}`;
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

registerEventDefinition({
  eventType: VENDOR_EMAIL_VERIFIED_EVENT_TYPE,
  eventVersion: VENDOR_EMAIL_VERIFIED_EVENT_VERSION,
  source: VENDOR_EMAIL_VERIFIED_EVENT_SOURCE,
  transport: 'eventbridge',
  classification: 'domain',
  ownerTeam: 'vendor',
  compatibility: 'strict',
});
