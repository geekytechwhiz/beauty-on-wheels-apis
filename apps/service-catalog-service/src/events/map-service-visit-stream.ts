import type { DynamoDBRecord } from 'aws-lambda';
import {
  SERVICE_VISIT_EVENT_SOURCE,
  SERVICE_VISIT_EVENT_VERSION,
  ServiceVisitSnapshotSchema,
  StreamRecordFilteredError,
  normalizeDynamoStreamRecord,
  serviceVisitEventType,
  serviceVisitIdempotencyKey,
  type BaseEvent,
  type ServiceVisitSnapshot,
} from '@api-hub/event-platform';
import { transitionChange, type VisitStatus } from '../domain/service-visits';

export function mapServiceVisitStreamRecord(raw: unknown): BaseEvent<ServiceVisitSnapshot> {
  const norm = normalizeDynamoStreamRecord(raw as DynamoDBRecord);
  if (norm.eventName === 'REMOVE' || !norm.newImage) {
    throw new StreamRecordFilteredError();
  }
  const image = norm.newImage;
  if (image.entityType !== 'ServiceVisitConfiguration') {
    throw new StreamRecordFilteredError();
  }
  const previous = norm.oldImage?.status;
  const next = image.status;
  if (typeof next !== 'string') {
    throw new StreamRecordFilteredError();
  }
  if (typeof previous === 'string' && previous === next && sameVersion(norm.oldImage, image)) {
    throw new StreamRecordFilteredError();
  }
  const change = transitionChange(
    typeof previous === 'string' ? previous as VisitStatus : undefined,
    next as VisitStatus,
  );
  const snapshot = ServiceVisitSnapshotSchema.parse({
    vendorId: image.vendorId,
    visitId: image.visitId,
    configurationVersion: image.version,
    occurredAt: image.updatedAt,
    change,
    name: image.name,
    deliveryModel: image.deliveryModel,
    location: image.location,
    timezone: image.timezone,
    windows: image.windows,
    serviceIds: image.serviceIds,
    services: image.services,
    ...(Array.isArray(image.staffIds) && image.staffIds.length ? { staffIds: image.staffIds } : {}),
    effectiveFrom: image.effectiveFrom,
    effectiveUntil: image.effectiveUntil ?? null,
    status: image.status,
  });
  return {
    eventId: norm.eventID,
    eventType: serviceVisitEventType(change),
    eventVersion: SERVICE_VISIT_EVENT_VERSION,
    timestamp: snapshot.occurredAt,
    source: SERVICE_VISIT_EVENT_SOURCE,
    idempotencyKey: serviceVisitIdempotencyKey(snapshot.visitId, snapshot.configurationVersion, change),
    payload: snapshot,
    meta: {
      correlationId: norm.correlationId?.trim() || norm.eventID,
      traceId: norm.traceId,
      causationId: norm.causationId,
      publishedAt: snapshot.occurredAt,
      attributes: { streamEventId: norm.eventID },
    },
  };
}

function sameVersion(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): boolean {
  return previous?.version === next.version;
}
