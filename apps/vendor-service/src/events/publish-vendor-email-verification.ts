import {
  publishEvent,
  VendorEmailVerificationRequestedEvent,
  vendorEmailVerificationRequestedIdempotencyKey,
  type VendorEmailVerificationRequestedPayload,
} from '@api-hub/event-platform';

import { ensureVendorEventPlatform } from './configure-vendor-event-platform';
import { getVendorsRepository } from '../repositories/vendors.repository';

/** Publishes with the request identity, never a stream delivery identity. */
export async function publishVendorEmailVerificationRequested(
  payload: VendorEmailVerificationRequestedPayload,
  correlationId: string,
): Promise<void> {
  const request = payload as unknown as { vendorId: string; verificationRequestId: string };
  ensureVendorEventPlatform();
  await publishEvent(VendorEmailVerificationRequestedEvent, payload, {
    idempotencyKey: vendorEmailVerificationRequestedIdempotencyKey(
      request.vendorId,
      request.verificationRequestId,
    ),
    meta: { correlationId },
  });
}

/** Best-effort acknowledgement only after EventBridge accepts the event. */
export async function markVendorEmailVerificationDispatched(
  vendorId: string,
  verificationRequestId: string,
): Promise<void> {
  const repository = getVendorsRepository();
  const profile = await repository.getVendorById(vendorId);
  if (!profile || profile.emailVerificationRequestId !== verificationRequestId || !profile.emailVerificationDispatchPending) return;
  const timestamp = new Date().toISOString();
  await repository.transactVendorProfile({
    profile: {
      ...profile,
      // The bearer token is needed only to build the EventBridge payload. Once
      // accepted it is retained solely as a hash for verification.
      emailVerificationOtp: undefined,
      emailVerificationDispatchPending: false,
      emailVerificationDispatchedAt: timestamp,
      updatedAt: timestamp,
    },
    expectedUpdatedAt: profile.updatedAt,
  });
}
