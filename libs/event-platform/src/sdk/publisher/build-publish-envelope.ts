import { randomUUID } from 'node:crypto';

import type { BaseEvent } from '../../core/event-envelope/base-event';
import { generateIdempotencyKey } from '../../core/idempotency/generate-idempotency-key';
import type { PublishInput } from './publish-input';

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
    });

  return {
    eventId,
    eventType: input.eventType,
    version,
    timestamp,
    source: input.source,
    correlationId: input.correlationId,
    idempotencyKey,
    payload: input.payload,
  };
}
