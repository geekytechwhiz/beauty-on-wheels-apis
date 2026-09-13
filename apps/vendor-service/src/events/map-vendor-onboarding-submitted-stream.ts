import type { DynamoDBRecord } from 'aws-lambda';
import {
  createDynamoStreamMapRawToBaseEvent,
  normalizeDynamoStreamRecord,
  StreamRecordFilteredError,
  VendorOnboardingSubmittedEvent,
  vendorOnboardingSubmittedIdempotencyKey,
  type BaseEvent,
  type VendorOnboardingSubmittedPayload,
} from '@api-hub/event-platform';

export function isVendorOnboardingSubmittedTransition(
  oldImage: Record<string, unknown> | undefined,
  newImage: Record<string, unknown> | undefined,
): boolean {
  if (!newImage || newImage.entityType !== 'Vendor') {
    return false;
  }
  if (newImage.onboardingStatus !== 'PENDING_REVIEW') {
    return false;
  }
  return oldImage?.onboardingStatus !== 'PENDING_REVIEW';
}

export function toVendorOnboardingSubmittedPayload(
  newImage: Record<string, unknown>,
): VendorOnboardingSubmittedPayload {
  return {
    applicationId: String(newImage.applicationId ?? ''),
    vendorId: String(newImage.vendorId ?? ''),
    ownerUserId: String(newImage.ownerUserId ?? ''),
    email: String(newImage.email ?? ''),
    onboardingStatus: 'PENDING_REVIEW',
    ...(typeof newImage.businessName === 'string' && newImage.businessName.trim()
      ? { businessName: newImage.businessName }
      : {}),
  };
}

const platformMapper = createDynamoStreamMapRawToBaseEvent([
  {
    table: 'vendor',
    eventName: ['MODIFY'],
    schema: VendorOnboardingSubmittedEvent,
  },
]);

/**
 * Extends the Event Platform stream mapper: unmatched table/eventName records
 * are already filtered; this additionally requires OLD status != PENDING_REVIEW
 * and NEW status == PENDING_REVIEW on the Vendor profile item.
 */
export function mapVendorOnboardingSubmittedStreamRecord(
  raw: unknown,
): BaseEvent<VendorOnboardingSubmittedPayload> {
  const mapped = platformMapper(raw);
  const norm = normalizeDynamoStreamRecord(raw as DynamoDBRecord);

  if (!isVendorOnboardingSubmittedTransition(norm.oldImage, norm.newImage)) {
    throw new StreamRecordFilteredError();
  }

  const payload = toVendorOnboardingSubmittedPayload(norm.newImage ?? {});

  return {
    ...mapped,
    payload,
    idempotencyKey: payload.applicationId
      ? vendorOnboardingSubmittedIdempotencyKey(payload.applicationId)
      : mapped.idempotencyKey,
  };
}
