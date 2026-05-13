import type { SQSRecord } from 'aws-lambda';

import { normalizeTransportToPayloadCandidate } from '../sdk/consumer/transport-normalize';

/**
 * Best-effort coercion of an unknown batch item to {@link SQSRecord}.
 * Returns undefined when the shape is not an SQS record.
 */
export function getSqsRecordShape(raw: unknown): SQSRecord | undefined {
  if (raw === null || typeof raw !== 'object') {
    return undefined;
  }
  const r = raw as Partial<SQSRecord>;
  if (typeof r.messageId !== 'string' || typeof r.body !== 'string') {
    return undefined;
  }
  return raw as SQSRecord;
}

/**
 * FIFO identifiers when present on the SQS record (standard attributes map).
 */
export function sqsRecordFifoMetadata(raw: unknown): {
  fifoMessageGroupId?: string;
  fifoMessageDeduplicationId?: string;
  fifoSequenceNumber?: string;
} {
  const r = getSqsRecordShape(raw);
  const a = r?.attributes;
  if (!a || typeof a !== 'object') {
    return {};
  }
  const attrs = a as unknown as Record<string, string>;
  return {
    ...(typeof attrs.MessageGroupId === 'string'
      ? { fifoMessageGroupId: attrs.MessageGroupId }
      : {}),
    ...(typeof attrs.MessageDeduplicationId === 'string'
      ? { fifoMessageDeduplicationId: attrs.MessageDeduplicationId }
      : {}),
    ...(typeof attrs.SequenceNumber === 'string'
      ? { fifoSequenceNumber: attrs.SequenceNumber }
      : {}),
  };
}

/**
 * Reads SQS ApproximateReceiveCount from the record attributes (1-based delivery counter).
 */
export function approximateReceiveCountFromSqsRecord(
  raw: unknown,
): number | undefined {
  const r = getSqsRecordShape(raw);
  const rawCount = r?.attributes?.ApproximateReceiveCount;
  if (rawCount === undefined) {
    return undefined;
  }
  const n = Number.parseInt(String(rawCount), 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/**
 * Resolves a correlation hint from message attributes or from the unwrapped payload's
 * `meta.correlationId` when it is already a JSON object (after SNS unwrap).
 */
export function correlationHintFromSqsRecord(raw: unknown): string | undefined {
  const r = getSqsRecordShape(raw);
  try {
    const attr = r?.messageAttributes?.correlationId?.stringValue;
    if (typeof attr === 'string' && attr.trim().length > 0) {
      return attr.trim();
    }
  } catch {
    /* optional messageAttributes shape */
  }
  try {
    const candidate = normalizeTransportToPayloadCandidate(raw);
    if (candidate !== null && typeof candidate === 'object') {
      const meta = (candidate as { meta?: { correlationId?: string } }).meta;
      const c = meta?.correlationId;
      if (typeof c === 'string' && c.trim().length > 0) {
        return c.trim();
      }
    }
  } catch {
    /* parsing / unwrap failed — caller may fall back to messageId */
  }
  return undefined;
}

/**
 * Fields merged into observability AsyncLocalStorage for the duration of one SQS record.
 * Keeps concurrent batch workers from sharing one correlation scope.
 */
export function buildSqsPerMessageLoggerContext(input: {
  rawRecord: unknown;
  operation: string;
  lambdaAwsRequestId?: string;
}): Record<string, string | number | undefined> {
  const r = getSqsRecordShape(input.rawRecord);
  const messageId = r?.messageId ?? 'unknown';
  const correlation =
    correlationHintFromSqsRecord(input.rawRecord) ?? messageId;
  const receiveCount = approximateReceiveCountFromSqsRecord(input.rawRecord);

  return {
    correlationId: correlation,
    awsRequestId: input.lambdaAwsRequestId,
    operation: input.operation,
    messageId,
    ...(receiveCount !== undefined ? { approximateReceiveCount: receiveCount } : {}),
    ...sqsRecordFifoMetadata(input.rawRecord),
  };
}
