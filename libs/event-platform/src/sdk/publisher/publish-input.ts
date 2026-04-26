/**
 * Input for {@link buildPublishEnvelope}. Optional envelope fields are filled with
 * service defaults in {@link createSnsPublishEvent} or other factories.
 */
export type PublishInput<T = unknown> = {
  eventType: string;
  /** Defaults to `1.0.0` when building the envelope. */
  version?: string;
  source: string;
  payload: T;
  correlationId?: string;
  eventId?: string;
  /** ISO-8601; defaults to `new Date().toISOString()`. */
  timestamp?: string;
  /** Defaults to a deterministic key from {@link generateIdempotencyKey} over envelope fields. */
  idempotencyKey?: string;
  metadata?: {
    retryCount?: number;
    publishedAt?: string;
  }; 
};
