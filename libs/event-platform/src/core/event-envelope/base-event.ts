/**
 * Cross-cutting metadata passed to async handlers (with {@link consumeEvent} / {@link createEventHandler}).
 */
export type EventMetadata = {
  correlationId?: string;
  retryCount?: number;
  publishedAt?: string;
};

/** @alias {@link EventMetadata} — used by older consumer call sites. */
export type EventHandlerMeta = EventMetadata;
export type EventMeta = {
  retryCount: number;
  publishedAt: string;
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
  meta?: EventMeta;
};

/** Canonical wire envelope — alias of {@link BaseEvent} for publishers/consumers. */
export type EventEnvelope<T = unknown> = BaseEvent<T>;
