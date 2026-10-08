import type { DynamoDBRecord } from 'aws-lambda';
import {
  createDynamoStreamMapRawToBaseEvent,
  normalizeDynamoStreamRecord,
  StreamRecordFilteredError,
  VendorEmailVerificationRequestedEvent,
  vendorEmailVerificationRequestedIdempotencyKey,
  type BaseEvent,
  type VendorEmailVerificationRequestedPayload,
} from '@api-hub/event-platform';

import {
  EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
  firstNameFromContactName,
  hasValidRegisteredEmail,
} from '../domain/email-verification';
import { hasCompletedEmailVerificationSections } from '../domain/onboarding';

export function isVendorEmailVerificationRequestedTransition(
  oldImage: Record<string, unknown> | undefined,
  newImage: Record<string, unknown> | undefined,
): boolean {
  if (!newImage || newImage.entityType !== 'Vendor') {
    return false;
  }
  if (newImage.status !== EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS) {
    return false;
  }
  return (
    !newImage.emailVerifiedAt &&
    !newImage.emailVerificationConsumedAt &&
    !newImage.emailVerificationRevokedAt &&
    !hasCompletedEmailVerificationSections(oldImage?.completedSections) &&
    hasCompletedEmailVerificationSections(newImage.completedSections)
  );
}

export function toVendorEmailVerificationRequestedPayload(
  newImage: Record<string, unknown>,
): VendorEmailVerificationRequestedPayload {
  const expiryMinutes = Number(newImage.emailVerificationExpiryMinutes);
  return {
    vendorId: String(newImage.vendorId ?? ''),
    verificationRequestId: String(newImage.emailVerificationRequestId ?? ''),
    intent: 'VENDOR_EMAIL_VERIFICATION',
    ownerUserId: String(newImage.ownerUserId ?? ''),
    email: String(newImage.email ?? ''),
    firstName: firstNameFromContactName(newImage.contactName),
    otp: String(newImage.emailVerificationOtp ?? ''),
    expiryMinutes: Number.isFinite(expiryMinutes) && expiryMinutes > 0
      ? expiryMinutes
      : VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
    vendorStatus: EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS,
    ...(typeof newImage.applicationId === 'string' && newImage.applicationId.trim()
      ? { applicationId: newImage.applicationId }
      : {}),
  };
}

const platformMapper = createDynamoStreamMapRawToBaseEvent([
  {
    table: 'vendor',
    eventName: ['MODIFY'],
    schema: VendorEmailVerificationRequestedEvent,
  },
]);

/**
 * Extends the Event Platform stream mapper: unmatched table/eventName records
 * are already filtered; this additionally requires OLD status != ACTIVE
 * and NEW status == ACTIVE on the Vendor profile item.
 */
export function mapVendorEmailVerificationRequestedStreamRecord(
  raw: unknown,
): BaseEvent<VendorEmailVerificationRequestedPayload> {
  const mapped = platformMapper(raw);
  const norm = normalizeDynamoStreamRecord(raw as DynamoDBRecord);

  if (!isVendorEmailVerificationRequestedTransition(norm.oldImage, norm.newImage)) {
    throw new StreamRecordFilteredError();
  }

  const payload = toVendorEmailVerificationRequestedPayload(norm.newImage ?? {});
  if (
    !hasValidRegisteredEmail(payload.email) ||
    !payload.verificationRequestId ||
    !payload.firstName ||
    !payload.otp
  ) {
    throw new StreamRecordFilteredError();
  }

  return {
    ...mapped,
    payload,
    idempotencyKey: payload.vendorId && payload.verificationRequestId
      ? vendorEmailVerificationRequestedIdempotencyKey(
          payload.vendorId,
          payload.verificationRequestId,
        )
      : mapped.idempotencyKey,
  };
}
