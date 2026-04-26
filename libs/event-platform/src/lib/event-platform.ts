// libs/event-platform/src/lib/event-platform.ts

import {
  type BaseEvent,
  type EventMetadata,
} from 'src/core/event-envelope/base-event';
import { EventConsumer } from '../sdk/consumer/event-consumer';
import type {
  EventConsumerDeps,
  HandleResult,
} from '../sdk/consumer/event-consumer';

type StreamOrSqsRecord = {
  messageId?: string;
  eventID?: string;
  sequenceNumber?: string;
};

function itemIdentifierFromRecord(record: unknown): string {
  if (record !== null && typeof record === 'object') {
    const r = record as StreamOrSqsRecord;
    return r.messageId ?? r.eventID ?? r.sequenceNumber ?? 'unknown';
  }
  return 'unknown';
}

/**
 * Wraps business handler with:
 * - idempotency (hybrid)
 * - retry + DLQ (via EventConsumer)
 * - batch support (SQS / Streams)
 */
export function consumeEvent<TPayload = unknown>(
  deps: EventConsumerDeps,
  handler: (payload: TPayload, meta: EventMetadata) => Promise<void>
): (
  rawEvent: unknown
) => Promise<HandleResult | { batchItemFailures: { itemIdentifier: string }[] }> {

  // ✅ reuse across Lambda invocations
  const consumer = new EventConsumer(deps);

  return async function wrapped(rawEvent: unknown) {

    // -------------------------------
    // 🔥 1. Batch Handling (SQS / Streams)
    // -------------------------------
    const records =
      rawEvent !== null &&
      typeof rawEvent === 'object' &&
      'Records' in rawEvent &&
      Array.isArray((rawEvent as { Records: unknown }).Records)
        ? (rawEvent as { Records: unknown[] }).Records
        : null;

    if (records) {
      const batchItemFailures: { itemIdentifier: string }[] = [];

      for (const record of records) {
        try {
          const result = await consumer.handle<TPayload>(
            record,
            async (event: BaseEvent<TPayload>) =>
              handler(event.payload, { correlationId: event.correlationId })
          );

          // 🔥 Duplicate → treat as success (DO NOT retry)
          if (result.outcome === 'duplicate') {
            continue;
          }

          // 🔥 DLQ candidate → mark as failed (optional strategy)
          if (result.outcome === 'dead_letter_candidate') {
            batchItemFailures.push({
              itemIdentifier: itemIdentifierFromRecord(record),
            });
          }

        } catch {
          // 🔥 HARD FAILURE → retry this message only
          batchItemFailures.push({
            itemIdentifier: itemIdentifierFromRecord(record),
          });
        }
      }

      return { batchItemFailures };
    }

    // -------------------------------
    // 🔥 2. Single Event (EventBridge / direct)
    // -------------------------------
    const result = await consumer.handle<TPayload>(rawEvent, async (event) =>
      handler(event.payload, { correlationId: event.correlationId })
    );
    // duplicate → treated as success
    return result;
  };
}