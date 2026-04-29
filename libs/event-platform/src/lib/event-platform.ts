// libs/event-platform/src/lib/event-platform.ts

import {
  type BaseEvent,
  type EventMeta
} from '../core/event-envelope/base-event';
import { EventConsumer } from '../sdk/consumer/event-consumer';
import type { 
  HandleResult,
} from '../sdk/consumer/event-consumer';
import { EventConsumerDeps, StreamOrSqsRecord, VersionedPayloadSchemas } from '../typings/consumer.types';


function resolveSchema(
  schemas: VersionedPayloadSchemas | undefined,
  eventType: string,
  version: string
) {
  const eventSchemas = schemas?.[eventType];

  if (!eventSchemas) {
    throw new Error(`No schemas found for eventType: ${eventType}`);
  }

  const schema = eventSchemas[version];

  if (!schema) {
    throw new Error(
      `No schema for eventType=${eventType}, version=${version}`
    );
  }

  return schema;
}
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
  handler: (event: BaseEvent<TPayload>) => Promise<void>
): (
  rawEvent: unknown
) => Promise<HandleResult | { batchItemFailures: { itemIdentifier: string }[] }> {

  const consumer = new EventConsumer(deps);

  async function process(raw: unknown) {
    return consumer.handle<TPayload>(raw, async (event) => {

      // 🔥 Resolve schema dynamically
      const schema = resolveSchema(
        deps.payloadSchemas as unknown as VersionedPayloadSchemas,
        event.eventType,
        event.eventVersion
      );

      // 🔥 Validate payload
      const parsedPayload = schema.parse(event.payload);

      const enrichedEvent: BaseEvent<TPayload> = {
        ...event,
        payload: parsedPayload,
      };

      return handler(enrichedEvent);
    });
  }

  return async function wrapped(rawEvent: unknown) {

    // -------------------------------
    // 🔥 Batch Handling
    // -------------------------------
    const records =
      rawEvent !== null &&
      typeof rawEvent === 'object' &&
      'Records' in rawEvent &&
      Array.isArray((rawEvent as any).Records)
        ? (rawEvent as any).Records
        : null;

    if (records) {
      const batchItemFailures: { itemIdentifier: string }[] = [];

      for (const record of records) {
        try {
          const result = await process(record);

          if (result.outcome === 'duplicate') continue;

          if (result.outcome === 'dead_letter_candidate') {
            batchItemFailures.push({
              itemIdentifier: itemIdentifierFromRecord(record),
            });
          }

        } catch {
          batchItemFailures.push({
            itemIdentifier: itemIdentifierFromRecord(record),
          });
        }
      }

      return { batchItemFailures };
    }

    // -------------------------------
    // 🔥 Single Event
    // -------------------------------
    return process(rawEvent);
  };
}