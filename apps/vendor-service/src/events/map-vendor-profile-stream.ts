import type { DynamoDBRecord } from 'aws-lambda';
import {
  createDynamoStreamMapRawToBaseEvent,
  normalizeDynamoStreamRecord,
  StreamRecordFilteredError,
  vendorEmailVerificationRequestedIdempotencyKey,
  type BaseEvent,
} from '@api-hub/event-platform';
import { getLogger } from '@api-hub/observability';

import {
  displayNameFromVendorProfile,
  shouldInitiateAccountProvisioning,
} from '../domain/vendor-profile-stream';
import {
  isVendorEmailVerificationRequestedTransition,
  toVendorEmailVerificationRequestedPayload,
} from './map-vendor-email-verification-requested-stream';
import {
  VendorProfileStreamWorkEvent,
  type VendorProfileStreamWorkPayload,
} from './vendor-profile-stream.work';
import {
  hasValidRegisteredEmail,
} from '../domain/email-verification';

const platformMapper = createDynamoStreamMapRawToBaseEvent([
  {
    table: 'vendor',
    eventName: ['INSERT', 'MODIFY'],
    schema: VendorProfileStreamWorkEvent,
  },
]);

function optionalEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return hasValidRegisteredEmail(trimmed) ? trimmed : undefined;
}

/**
 * Maps a vendor PROFILE stream record to consolidated work.
 * Unrelated records and no-op transitions throw StreamRecordFilteredError (acked).
 */
export function mapVendorProfileStreamRecord(
  raw: unknown,
): BaseEvent<VendorProfileStreamWorkPayload> {
  const mapped = platformMapper(raw);
  const norm = normalizeDynamoStreamRecord(raw as DynamoDBRecord);
  const eventName = String(norm.eventName);
  const vendorId = String(
    norm.newImage?.vendorId ?? norm.oldImage?.vendorId ?? '',
  );

  getLogger().info('vendor_stream_record_received', {
    vendorId,
    eventName,
    eventId: norm.eventID,
    operation: 'vendor.profile.stream',
  });

  if (eventName !== 'INSERT' && eventName !== 'MODIFY') {
    throw new StreamRecordFilteredError();
  }

  const needsAccountProvisioning = shouldInitiateAccountProvisioning({
    eventName,
    oldImage: norm.oldImage,
    newImage: norm.newImage,
  });

  const needsEmailVerification = isVendorEmailVerificationRequestedTransition(
    norm.oldImage,
    norm.newImage,
  );

  if (!needsAccountProvisioning && !needsEmailVerification) {
    throw new StreamRecordFilteredError();
  }

  const newImage = norm.newImage ?? {};
  let emailVerification: VendorProfileStreamWorkPayload['emailVerification'];
  if (needsEmailVerification) {
    const payload = toVendorEmailVerificationRequestedPayload(newImage);
    if (
      !hasValidRegisteredEmail(payload.email) ||
      !payload.verificationRequestId ||
      !payload.ownerName ||
      !payload.businessName ||
      !payload.verificationToken
    ) {
      if (!needsAccountProvisioning) {
        throw new StreamRecordFilteredError();
      }
    } else {
      emailVerification = {
        ...payload,
        // Staff-created vendors may not have ownerUserId until provisioning
        // completes; email delivery does not require it.
        ownerUserId: payload.ownerUserId?.trim()
          ? payload.ownerUserId
          : 'pending',
      };
    }
  }

  const provisioning = needsAccountProvisioning
    ? {
        loginPhoneNumber: String(newImage.loginPhoneNumber ?? '').trim(),
        displayName: displayNameFromVendorProfile(newImage),
        ...(optionalEmail(newImage.email)
          ? { email: optionalEmail(newImage.email) }
          : {}),
      }
    : undefined;

  if (needsAccountProvisioning && !provisioning?.loginPhoneNumber) {
    throw new StreamRecordFilteredError();
  }

  const effectiveNeedsEmail = Boolean(emailVerification);
  if (!needsAccountProvisioning && !effectiveNeedsEmail) {
    throw new StreamRecordFilteredError();
  }

  const payload: VendorProfileStreamWorkPayload = {
    vendorId,
    streamEventName: eventName,
    needsAccountProvisioning,
    needsEmailVerification: effectiveNeedsEmail,
    ...(provisioning ? { provisioning } : {}),
    ...(emailVerification ? { emailVerification } : {}),
  };

  const idempotencyKey = effectiveNeedsEmail && emailVerification
    ? vendorEmailVerificationRequestedIdempotencyKey(
        vendorId,
        emailVerification.verificationRequestId,
      )
    : needsAccountProvisioning
      ? `Vendor.ProfileStreamWork:provision:${vendorId}:${norm.eventID}`
      : mapped.idempotencyKey;

  getLogger().info('vendor_profile_stream_work_detected', {
    vendorId,
    eventId: norm.eventID,
    correlationId: mapped.meta.correlationId,
    operation: 'vendor.profile.stream',
    needsAccountProvisioning,
    needsEmailVerification: effectiveNeedsEmail,
    outcome: 'mapped',
  });

  return {
    ...mapped,
    payload,
    idempotencyKey,
  };
}
