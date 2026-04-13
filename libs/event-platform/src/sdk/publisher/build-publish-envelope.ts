import { randomUUID } from 'node:crypto';

import type { BaseEvent } from '../../core/event-envelope/base-event';
import { generateIdempotencyKey } from '../../core/idempotency/generate-idempotency-key';
import type { PublishInput } from './publish-input';

/** Builds a wire-ready {@link BaseEvent} from publisher input (pure except UUID + clock). */
export function buildPublishEnvelope<T>(input: PublishInput<T>): BaseEvent<T> {
  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    version: input.version,
    timestamp: new Date().toISOString(),
    source: input.source,
    correlationId: input.correlationId,
    idempotencyKey: generateIdempotencyKey({
      eventType: input.eventType,
      version: input.version,
      source: input.source,
      payload: input.payload,
    }),
    payload: input.payload,
  };
}
