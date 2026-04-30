import { randomUUID } from 'node:crypto';

import type { BaseEvent } from '../../typings/base-event.types';
import { generateIdempotencyKey } from '../../core/idempotency/generate-idempotency-key';
import type { PublishInput } from '../../typings/publisher.types';

const DEFAULT_VERSION = '1.0.0';

/** Builds a wire-ready {@link BaseEvent} from publisher input (pure except UUID + clock). */
export function buildPublishEnvelope<T>(input: PublishInput<T>): BaseEvent<T> {
  const version = input.version ?? DEFAULT_VERSION;
  const eventId = input.eventId ?? randomUUID();
  const timestamp = input.timestamp ?? new Date().toISOString();
  const idempotencyKey =
    input.idempotencyKey ??
    generateIdempotencyKey({
      eventType: input.eventType,
      version,
      source: input.source,
      payload: input.payload,
      eventId: randomUUID() as string,
    });

    return {
      eventId,
      eventType: input.eventType,
      eventVersion: version, // ✅ correct field
      timestamp,
      source: input.source,
      idempotencyKey,
      payload: input.payload,
      meta: {
        correlationId: input.correlationId ?? eventId,
        publishedAt: timestamp,
        retryCount: 0,
      },
    };
}
