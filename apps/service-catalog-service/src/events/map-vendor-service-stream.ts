import type { DynamoDBRecord } from 'aws-lambda';
import {
  StreamRecordFilteredError,
  VENDOR_SERVICE_EVENT_SOURCE,
  VENDOR_SERVICE_EVENT_TYPES,
  VENDOR_SERVICE_EVENT_VERSION,
  normalizeDynamoStreamRecord,
  vendorServiceIdempotencyKey,
  type BaseEvent,
  type VendorServiceSnapshot,
} from '@api-hub/event-platform';

/** Maps only the authoritative SERVICE row. Lookup and index rows are ignored. */
export function mapVendorServiceStreamRecord(raw: unknown): BaseEvent<VendorServiceSnapshot> {
  const record = normalizeDynamoStreamRecord(raw as DynamoDBRecord);
  const image = record.eventName === 'REMOVE' ? record.oldImage : record.newImage;
  if (!image || image.entityType !== 'SERVICE' || typeof image.vendorId !== 'string' || typeof image.serviceId !== 'string') {
    throw new StreamRecordFilteredError();
  }
  const version = typeof image.version === 'number' ? image.version : 0;
  const deleted = record.eventName === 'REMOVE' || Boolean(image.deletedAt);
  const snapshot: VendorServiceSnapshot = {
    vendorId: image.vendorId,
    serviceId: image.serviceId,
    version,
    active: !deleted && image.active === true,
    deleted,
    occurredAt: typeof image.updatedAt === 'string' ? image.updatedAt : new Date().toISOString(),
  };
  return {
    eventId: record.eventID,
    eventType: VENDOR_SERVICE_EVENT_TYPES.CHANGED,
    eventVersion: VENDOR_SERVICE_EVENT_VERSION,
    timestamp: snapshot.occurredAt,
    source: VENDOR_SERVICE_EVENT_SOURCE,
    idempotencyKey: vendorServiceIdempotencyKey(snapshot.serviceId, snapshot.version, snapshot.deleted),
    payload: snapshot,
    meta: { correlationId: record.correlationId?.trim() || record.eventID, traceId: record.traceId, causationId: record.causationId, publishedAt: snapshot.occurredAt, attributes: { streamEventId: record.eventID } },
  };
}
