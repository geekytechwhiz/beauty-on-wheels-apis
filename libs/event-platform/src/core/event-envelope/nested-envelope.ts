import type { BaseEvent } from './base-event';

/**
 * Logical event metadata (separate from `payload`) for documentation and client SDKs.
 * Wire format remains {@link BaseEvent} (flat); use {@link toNestedEventEnvelope} to convert.
 */
export type EventMetaBlock = {
  eventId: string;
  eventType: string;
  version: string;
  correlationId: string;
  timestamp: string;
  /** Set by the consumer when tracking retries; defaults to 0 for publishers. */
  retryCount: number;
};

/**
 * Docs-friendly nested envelope. Transport adapters serialize to {@link BaseEvent} for SQS / EventBridge.
 */
export type EventEnvelopeV2<T = unknown> = {
  meta: EventMetaBlock;
  payload: T;
};

export function toNestedEventEnvelope(
  e: BaseEvent<unknown>,
  retryCount = 0,
): EventEnvelopeV2<unknown> {
  return {
    meta: {
      eventId: e.eventId,
      eventType: e.eventType,
      version: e.version,
      correlationId: e.correlationId ?? '',
      timestamp: e.timestamp,
      retryCount,
    },
    payload: e.payload,
  };
}

export function toBaseEventFromNested<T>(envelope: EventEnvelopeV2<T>, source: string, idempotencyKey: string): BaseEvent<T> {
  return {
    eventId: envelope.meta.eventId,
    eventType: envelope.meta.eventType,
    version: envelope.meta.version,
    timestamp: envelope.meta.timestamp,
    source,
    correlationId: envelope.meta.correlationId || undefined,
    idempotencyKey,
    payload: envelope.payload,
  };
}
