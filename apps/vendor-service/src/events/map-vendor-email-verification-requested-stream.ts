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
import { getLogger } from '@api-hub/observability';

import {
  EMAIL_VERIFICATION_ELIGIBLE_VENDOR_STATUS,
  VENDOR_EMAIL_VERIFICATION_EXPIRY_MINUTES,
  firstNameFromContactName,
  hasValidRegisteredEmail,
} from '../domain/email-verification';

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
  // A persisted request is the business transition.  It may happen on vendor
  // creation, when business details make the template renderable, or on resend.
  // Do not tie it to the later onboarding-submission gate.
  return Boolean(
    !newImage.emailVerifiedAt &&
    !newImage.emailVerificationConsumedAt &&
    !newImage.emailVerificationRevokedAt &&
    newImage.emailVerificationDispatchPending &&
    newImage.emailVerificationRequestId &&
    newImage.emailVerificationOtp &&
    newImage.emailVerificationRequestId !== oldImage?.emailVerificationRequestId,
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
    ownerName: firstNameFromContactName(newImage.contactName),
    businessName: String(newImage.businessName ?? '').trim(),
    verificationToken: String(newImage.emailVerificationOtp ?? ''),
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

  getLogger().info('vendor_stream_record_received', {
    vendorId: norm.newImage?.vendorId ?? norm.oldImage?.vendorId,
    eventName: norm.eventName,
    eventId: norm.eventID,
    oldOnboardingStatus: norm.oldImage?.onboardingStatus,
    newOnboardingStatus: norm.newImage?.onboardingStatus,
  });

  if (!isVendorEmailVerificationRequestedTransition(norm.oldImage, norm.newImage)) {
    throw new StreamRecordFilteredError();
  }

  const payload = toVendorEmailVerificationRequestedPayload(norm.newImage ?? {});
  if (
    !hasValidRegisteredEmail(payload.email) ||
    !payload.verificationRequestId ||
    !payload.ownerName ||
    !payload.businessName ||
    !payload.verificationToken
  ) {
    throw new StreamRecordFilteredError();
  }

  getLogger().info('vendor_email_verification_request_detected', {
    vendorId: payload.vendorId,
    eventName: VendorEmailVerificationRequestedEvent.__meta.eventType,
    eventId: norm.eventID,
    correlationId: mapped.meta.correlationId,
    oldOnboardingStatus: norm.oldImage?.onboardingStatus,
    newOnboardingStatus: norm.newImage?.onboardingStatus,
  });

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
