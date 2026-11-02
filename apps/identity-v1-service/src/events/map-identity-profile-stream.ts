import type { DynamoDBRecord } from 'aws-lambda';
import {
  type BaseEvent,
  IDENTITY_REGISTERED_EVENT_TYPE,
  IDENTITY_USER_PROVISIONING_EVENT_VERSION,
  StreamRecordFilteredError,
  normalizeDynamoStreamRecord,
  identityRegisteredIdempotencyKey,
  type IdentityRegisteredPayload,
} from '@api-hub/event-platform';

/** The Serverless filter is the first gate; this is the durable second gate. */
export function mapIdentityProfileInsertStreamRecord(raw: unknown): BaseEvent<IdentityRegisteredPayload> {
  const record = normalizeDynamoStreamRecord(raw as DynamoDBRecord);
  const image = record.newImage;
  const userId = typeof image?.userId === 'string' && image.userId.trim()
    ? image.userId.trim()
    : typeof image?.PK === 'string' && image.PK.startsWith('USER#') && image.PK.slice(5).trim()
      ? image.PK.slice(5).trim()
      : undefined;
  if (
    record.eventName !== 'INSERT' ||
    image?.SK !== 'PROFILE' ||
    image.entityType !== 'Profile' ||
    !userId ||
    typeof image.identityId !== 'string' || !image.identityId.trim() ||
    (image.userProvisioning as { status?: unknown } | undefined)?.status !== 'PENDING'
  ) {
    throw new StreamRecordFilteredError();
  }
  const identityId = image.identityId.trim();

  return {
    eventId: record.eventID,
    eventType: IDENTITY_REGISTERED_EVENT_TYPE,
    eventVersion: IDENTITY_USER_PROVISIONING_EVENT_VERSION,
    source: 'identity-service',
    timestamp: String(image.createdAt ?? new Date().toISOString()),
    idempotencyKey: identityRegisteredIdempotencyKey(identityId),
    // Verification facts are read from META by the handler; PROFILE is not the
    // authority for them and must not expose a pre-verification profile.
    payload: { identityId, userId, phoneVerified: false },
    meta: {
      correlationId: record.correlationId?.trim() || record.eventID,
      traceId: record.traceId,
      causationId: record.causationId,
      publishedAt: String(image.createdAt ?? new Date().toISOString()),
    },
  };
}
