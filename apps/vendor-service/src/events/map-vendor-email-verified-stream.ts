import type { DynamoDBRecord } from 'aws-lambda';
import {
  StreamRecordFilteredError,
  VENDOR_EMAIL_VERIFIED_EVENT_SOURCE,
  VENDOR_EMAIL_VERIFIED_EVENT_TYPE,
  VENDOR_EMAIL_VERIFIED_EVENT_VERSION,
  normalizeDynamoStreamRecord,
  vendorEmailVerifiedIdempotencyKey,
  type BaseEvent,
  type VendorEmailVerifiedPayload,
} from '@api-hub/event-platform';

import { ONBOARDING_SECTION_ORDER } from '../domain/onboarding';

function onboardingIsComplete(completedSections: unknown): boolean {
  if (!Array.isArray(completedSections)) return false;
  const completed = new Set(completedSections);
  return ONBOARDING_SECTION_ORDER.every((section) => completed.has(section));
}

/**
 * The Vendor profile is the authoritative source.  A client cannot cause this
 * event merely by posting a userId or vendorId: the stream must observe the
 * verified-email transition on a fully completed Vendor profile.
 */
export function isVendorEmailVerifiedTransition(
  oldImage: Record<string, unknown> | undefined,
  newImage: Record<string, unknown> | undefined,
): boolean {
  return Boolean(
    newImage?.entityType === 'Vendor' &&
      !oldImage?.emailVerifiedAt &&
      typeof newImage.emailVerifiedAt === 'string' &&
      newImage.emailVerifiedAt &&
      typeof newImage.ownerUserId === 'string' &&
      newImage.ownerUserId.trim() &&
      onboardingIsComplete(newImage.completedSections),
  );
}

export function mapVendorEmailVerifiedStreamRecord(
  raw: unknown,
): BaseEvent<VendorEmailVerifiedPayload> {
  const record = normalizeDynamoStreamRecord(raw as DynamoDBRecord);
  if (!isVendorEmailVerifiedTransition(record.oldImage, record.newImage)) {
    throw new StreamRecordFilteredError();
  }

  const newImage = record.newImage!;
  const payload: VendorEmailVerifiedPayload = {
    vendorId: String(newImage.vendorId ?? ''),
    userId: String(newImage.ownerUserId ?? '').trim(),
    emailVerified: true,
  };
  if (!payload.vendorId || !payload.userId) {
    throw new StreamRecordFilteredError();
  }

  const verifiedAt = String(newImage.emailVerifiedAt);
  return {
    eventId: record.eventID,
    eventType: VENDOR_EMAIL_VERIFIED_EVENT_TYPE,
    eventVersion: VENDOR_EMAIL_VERIFIED_EVENT_VERSION,
    source: VENDOR_EMAIL_VERIFIED_EVENT_SOURCE,
    timestamp: verifiedAt,
    idempotencyKey: vendorEmailVerifiedIdempotencyKey(payload.vendorId, verifiedAt),
    payload,
    meta: {
      correlationId:
        typeof (newImage.meta as { correlationId?: unknown } | undefined)
          ?.correlationId === 'string'
          ? String((newImage.meta as { correlationId: string }).correlationId)
          : record.correlationId?.trim() || record.eventID,
      traceId: record.traceId,
      causationId: record.causationId,
      publishedAt: verifiedAt,
    },
  };
}
