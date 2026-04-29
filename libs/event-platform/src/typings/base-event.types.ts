/**
 * Cross-cutting metadata passed to async handlers (with {@link consumeEvent} / {@link createEventHandler}).
 */
  
/**
 * Canonical wire shape for platform events (see docs/prompt/event-platform/step1.md).
 */
export type BaseEvent<T = unknown> = {
  eventId: string;
  eventType: string;
  eventVersion: string;
  timestamp: string;
  source: string;
  idempotencyKey: string;
  payload: T;
  meta: EventMeta;
};

export type EventMeta = {
  correlationId: string;
  traceId?: string;
  spanId?: string;
  retryCount?: number;
  publishedAt?: string;
  tenantId?: string;
  userId?: string;
  channel?: 'web' | 'mobile' | 'system' | 'cron' | string;
  environment?: 'dev' | 'qa' | 'staging' | 'prod';
  schemaRef?: string;
  causationId?: string;
  attributes?: Record<string, unknown>;
};
/** Canonical wire envelope — alias of {@link BaseEvent} for publishers/consumers. */
export type EventEnvelope<T = unknown> = BaseEvent<T>;


export type NormalizeMetaOptions = {
  fallbackCorrelationId?: string;
  defaultChannel?: string;
  defaultEnvironment?: string;
};