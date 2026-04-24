/**
 * Cross-cutting metadata often carried alongside an event (extend as needed).
 */
export type EventMetadata = {
  correlationId?: string;
};

/**
 * Canonical wire shape for platform events (see docs/prompt/event-platform/step1.md).
 */
export type BaseEvent<T = unknown> = {
  eventId: string;
  eventType: string;
  version: string;
  timestamp: string;
  source: string;
  correlationId?: string;
  idempotencyKey: string;
  payload: T;
};

/** Canonical wire envelope — alias of {@link BaseEvent} for publishers/consumers. */
export type EventEnvelope<T = unknown> = BaseEvent<T>;
