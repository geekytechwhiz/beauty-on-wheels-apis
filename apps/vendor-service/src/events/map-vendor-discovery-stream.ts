import type { DynamoDBRecord } from 'aws-lambda';
import {
  StreamRecordFilteredError,
  VENDOR_DISCOVERY_CHANGED_EVENT_SOURCE,
  VENDOR_DISCOVERY_CHANGED_EVENT_TYPE,
  VENDOR_DISCOVERY_CHANGED_EVENT_VERSION,
  normalizeDynamoStreamRecord,
  vendorDiscoveryChangedIdempotencyKey,
  type BaseEvent,
  type VendorDiscoveryChangedPayload,
  type VendorDiscoverySubject,
} from '@api-hub/event-platform';

const DISCOVERY_ENTITIES: Record<string, VendorDiscoverySubject> = {
  VendorBranch: 'branch',
  ServiceArea: 'coverage',
  VendorCapabilities: 'pricing',
};

export function classifyVendorDiscoveryChange(
  eventName: string | undefined,
  oldImage: Record<string, unknown> | undefined,
  newImage: Record<string, unknown> | undefined,
): VendorDiscoveryChangedPayload | undefined {
  const current = eventName === 'REMOVE' ? oldImage : newImage;
  if (!current) {
    return undefined;
  }
  const entityType = current.entityType;
  const vendorId = current.vendorId;
  const updatedAt = current.updatedAt;
  if (typeof vendorId !== 'string' || vendorId.trim() === '' || typeof updatedAt !== 'string') {
    return undefined;
  }

  if (entityType === 'Vendor') {
    if (eventName !== 'MODIFY' || current.SK !== 'PROFILE') {
      return undefined;
    }
    if (oldImage?.operationalStatus === newImage?.operationalStatus) {
      return undefined;
    }
    return { vendorId, updatedAt, subject: 'operations' };
  }

  if (typeof entityType !== 'string' || !(entityType in DISCOVERY_ENTITIES)) {
    return undefined;
  }
  return { vendorId, updatedAt, subject: DISCOVERY_ENTITIES[entityType] };
}

export function mapVendorDiscoveryStreamRecord(
  raw: unknown,
): BaseEvent<VendorDiscoveryChangedPayload> {
  const norm = normalizeDynamoStreamRecord(raw as DynamoDBRecord);
  const payload = classifyVendorDiscoveryChange(norm.eventName, norm.oldImage, norm.newImage);
  if (!payload) {
    throw new StreamRecordFilteredError();
  }
  const correlationId = typeof (norm.newImage?.meta as { correlationId?: string } | undefined)?.correlationId === 'string'
    ? String((norm.newImage?.meta as { correlationId?: string }).correlationId)
    : norm.correlationId?.trim() || norm.eventID;

  return {
    eventId: norm.eventID,
    eventType: VENDOR_DISCOVERY_CHANGED_EVENT_TYPE,
    eventVersion: VENDOR_DISCOVERY_CHANGED_EVENT_VERSION,
    timestamp: payload.updatedAt,
    source: VENDOR_DISCOVERY_CHANGED_EVENT_SOURCE,
    idempotencyKey: vendorDiscoveryChangedIdempotencyKey(norm.eventID),
    payload,
    meta: {
      correlationId,
      traceId: norm.traceId,
      causationId: norm.causationId,
      publishedAt: payload.updatedAt,
      attributes: { streamEventId: norm.eventID },
    },
  };
}
