import type { DynamoDBRecord } from 'aws-lambda';
import {
  StreamRecordFilteredError,
  VENDOR_APPROVED_EVENT_TYPE,
  VENDOR_LIFECYCLE_EVENT_VERSION,
  VENDOR_LIFECYCLE_EVENT_SOURCE,
  VENDOR_REJECTED_EVENT_TYPE,
  normalizeDynamoStreamRecord,
  vendorLifecycleIdempotencyKey,
  type BaseEvent,
  type VendorLifecyclePayload,
} from '@api-hub/event-platform';

export type VendorLifecycleKind = 'approved' | 'rejected';

export function classifyVendorLifecycleTransition(
  oldImage: Record<string, unknown> | undefined,
  newImage: Record<string, unknown> | undefined,
): VendorLifecycleKind | undefined {
  if (!newImage || newImage.entityType !== 'Vendor') {
    return undefined;
  }
  const previous = oldImage?.status;
  const next = newImage.status;
  if (typeof previous !== 'string' || typeof next !== 'string' || previous === next) {
    return undefined;
  }
  if (previous === 'PENDING_VERIFICATION' && next === 'ACTIVE') {
    return 'approved';
  }
  if (next === 'REJECTED') {
    return 'rejected';
  }
  return undefined;
}

export function toVendorLifecyclePayload(
  oldImage: Record<string, unknown>,
  newImage: Record<string, unknown>,
): VendorLifecyclePayload | undefined {
  const review = newImage.latestReview;
  if (!review || typeof review !== 'object') {
    return undefined;
  }
  const record = review as Record<string, unknown>;
  const actorUserId = record.reviewerUserId;
  const reviewedAt = record.reviewedAt;
  const vendorId = newImage.vendorId;
  const onboardingStatus = newImage.onboardingStatus;
  if (
    typeof actorUserId !== 'string' ||
    typeof reviewedAt !== 'string' ||
    typeof vendorId !== 'string' ||
    typeof onboardingStatus !== 'string' ||
    typeof oldImage.status !== 'string' ||
    typeof newImage.status !== 'string'
  ) {
    return undefined;
  }

  return {
    vendorId,
    previousStatus: oldImage.status,
    newStatus: newImage.status,
    actorUserId,
    reviewedAt,
    onboardingStatus,
    ...(typeof record.reason === 'string' && record.reason.trim()
      ? { reason: record.reason }
      : {}),
    ...(typeof newImage.ownerUserId === 'string' && newImage.ownerUserId.trim()
      ? { ownerUserId: newImage.ownerUserId.trim() }
      : {}),
  };
}

export function mapVendorLifecycleStreamRecord(
  raw: unknown,
): BaseEvent<VendorLifecyclePayload> {
  const norm = normalizeDynamoStreamRecord(raw as DynamoDBRecord);
  const kind = classifyVendorLifecycleTransition(norm.oldImage, norm.newImage);
  if (!kind || !norm.newImage || !norm.oldImage) {
    throw new StreamRecordFilteredError();
  }

  const payload = toVendorLifecyclePayload(norm.oldImage, norm.newImage);
  if (!payload) {
    throw new StreamRecordFilteredError();
  }

  const eventType =
    kind === 'approved' ? VENDOR_APPROVED_EVENT_TYPE : VENDOR_REJECTED_EVENT_TYPE;
  const correlationId =
    payload.vendorId &&
    typeof (norm.newImage.meta as { correlationId?: string } | undefined)
      ?.correlationId === 'string'
      ? String(
          (norm.newImage.meta as { correlationId?: string }).correlationId,
        )
      : norm.correlationId?.trim() || norm.eventID;

  return {
    eventId: norm.eventID,
    eventType,
    eventVersion: VENDOR_LIFECYCLE_EVENT_VERSION,
    timestamp: payload.reviewedAt,
    source: VENDOR_LIFECYCLE_EVENT_SOURCE,
    idempotencyKey: vendorLifecycleIdempotencyKey(
      eventType,
      payload.vendorId,
      payload.reviewedAt,
    ),
    payload,
    meta: {
      correlationId,
      traceId: norm.traceId,
      causationId: norm.causationId,
      publishedAt: payload.reviewedAt,
    },
  };
}
