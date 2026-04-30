import { randomUUID } from 'node:crypto';

import type { BaseEvent } from '@api-hub/event-platform';

/**
 * Maps an EventBridge-style envelope to {@link BaseEvent} for `createEventHandler` / `EventConsumer`.
 */
export function toBaseEventFromEventBridge<DPayload>(params: {
  eventType: string;
  source: string;
  eventVersion: string;
  parseDetail: (detail: unknown) => DPayload;
  raw: unknown;
}): BaseEvent<DPayload> {
  const eb = params.raw as { id?: string; time?: string; detail?: unknown };

  const detail = params.parseDetail(eb.detail);
  const id = eb.id ?? randomUUID();

  return {
    eventId: id,
    eventType: params.eventType,
    eventVersion: params.eventVersion,
    timestamp: typeof eb.time === 'string' ? eb.time : new Date().toISOString(),
    source: params.source,
    idempotencyKey: id,
    payload: detail,
    meta: {
      correlationId: id, // temp fallback (will improve in next fix)
    },
  };
}