import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DynamoDBRecord } from 'aws-lambda';

import { getLogger } from '@api-hub/observability';

import type { NormalizedDynamoStreamEvent } from './normalized-dynamo-stream-event';

function safeUnmarshall(
  image: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!image || typeof image !== 'object' || Object.keys(image).length === 0) {
    return undefined;
  }
  try {
    return unmarshall(image as Record<string, AttributeValue>) as Record<string, unknown>;
  } catch (err) {
    getLogger().warn('dynamo_stream_unmarshall_failed', {
      logType: 'dynamo_stream',
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Resolves logical table name from `eventSourceARN`:
 * `arn:aws:dynamodb:region:account:table/TableName/stream/...`
 */
export function tableNameFromDynamoStreamArn(arn: string | undefined): string | undefined {
  if (typeof arn !== 'string' || !arn.includes(':table/')) {
    return undefined;
  }
  const after = arn.split(':table/')[1];
  if (!after) {
    return undefined;
  }
  const name = after.split('/')[0];
  return name && name.length > 0 ? name : undefined;
}

function pickCorrelationId(
  ...sources: Array<Record<string, unknown> | undefined>
): string | undefined {
  for (const src of sources) {
    if (!src) {
      continue;
    }
    const meta = src.meta as Record<string, unknown> | undefined;
    const fromMeta =
      meta &&
      typeof meta.correlationId === 'string' &&
      meta.correlationId.trim().length > 0
        ? meta.correlationId.trim()
        : undefined;
    if (fromMeta) {
      return fromMeta;
    }
    const top =
      typeof src.correlationId === 'string' && src.correlationId.trim().length > 0
        ? src.correlationId.trim()
        : undefined;
    if (top) {
      return top;
    }
  }
  return undefined;
}

function pickTraceId(
  ...sources: Array<Record<string, unknown> | undefined>
): string | undefined {
  for (const src of sources) {
    if (!src) {
      continue;
    }
    const meta = src.meta as Record<string, unknown> | undefined;
    const fromMeta =
      meta && typeof meta.traceId === 'string' && meta.traceId.trim().length > 0
        ? meta.traceId.trim()
        : undefined;
    if (fromMeta) {
      return fromMeta;
    }
    const top =
      typeof src.traceId === 'string' && src.traceId.trim().length > 0
        ? src.traceId.trim()
        : undefined;
    if (top) {
      return top;
    }
  }
  return undefined;
}

function pickCausationId(
  ...sources: Array<Record<string, unknown> | undefined>
): string | undefined {
  for (const src of sources) {
    if (!src) {
      continue;
    }
    const meta = src.meta as Record<string, unknown> | undefined;
    const fromMeta =
      meta && typeof meta.causationId === 'string' && meta.causationId.trim().length > 0
        ? meta.causationId.trim()
        : undefined;
    if (fromMeta) {
      return fromMeta;
    }
    const top =
      typeof src.causationId === 'string' && src.causationId.trim().length > 0
        ? src.causationId.trim()
        : undefined;
    if (top) {
      return top;
    }
  }
  return undefined;
}

function pickRetryCount(
  ...sources: Array<Record<string, unknown> | undefined>
): number | undefined {
  for (const src of sources) {
    if (!src) {
      continue;
    }
    const meta = src.meta as Record<string, unknown> | undefined;
    const n = meta?.retryCount ?? src.retryCount;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      return Math.floor(n);
    }
  }
  return undefined;
}

/**
 * Normalizes a Lambda {@link DynamoDBRecord} into a unmarshalled, handler-safe shape.
 * Malformed AttributeValue maps are logged and omitted rather than throwing here
 * (mapping / schema layers still surface validation errors).
 */
export function normalizeDynamoStreamRecord(
  record: DynamoDBRecord,
): NormalizedDynamoStreamEvent {
  const keys = safeUnmarshall(record.dynamodb?.Keys) ?? {};
  const newImage = safeUnmarshall(record.dynamodb?.NewImage);
  const oldImage = safeUnmarshall(record.dynamodb?.OldImage);
  const tableName = tableNameFromDynamoStreamArn(record.eventSourceARN);
  const correlationId = pickCorrelationId(newImage, oldImage);
  const traceId = pickTraceId(newImage, oldImage);
  const causationId = pickCausationId(newImage, oldImage);
  const retryCount = pickRetryCount(newImage, oldImage);

  return {
    transport: 'dynamodb-stream',
    eventID: record.eventID ?? 'unknown',
    eventName: (record.eventName ?? 'UNKNOWN') as NormalizedDynamoStreamEvent['eventName'],
    sequenceNumber: record.dynamodb?.SequenceNumber,
    streamArn: record.eventSourceARN,
    tableName,
    keys,
    oldImage,
    newImage,
    approximateCreationDateTime: record.dynamodb?.ApproximateCreationDateTime,
    correlationId,
    traceId,
    causationId,
    retryCount,
    rawRecord: record,
  };
}

export function isDynamoDbStreamRecord(raw: unknown): raw is DynamoDBRecord {
  if (raw === null || typeof raw !== 'object') {
    return false;
  }
  const r = raw as Partial<DynamoDBRecord>;
  return (
    r.eventSource === 'aws:dynamodb' &&
    typeof r.eventID === 'string' &&
    r.dynamodb !== null &&
    typeof r.dynamodb === 'object'
  );
}
