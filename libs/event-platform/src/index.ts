// libs/event-platform/src/index.ts

export { consumeEvent } from './lib/event-platform';
export { createEventHandler } from './lib/create-event-handler';
export { createStreamHandler } from './lib/create-stream-handler';
export { normalizeTransportToPayloadCandidate } from './sdk/consumer/transport-normalize';

export type { BaseEvent, EventEnvelope, EventMetadata } from './core/event-envelope/base-event';
export type { EventHandlerMeta } from './core/event-envelope/base-event'; // alias for EventMetadata
export type { EventConsumerDeps } from './sdk/consumer/event-consumer';
export type { RetryOptions } from './core/retry/retry';
export { DomainIdempotencyStrategy } from './core/idempotency/domain-idempotency.strategy';
export { StoreIdempotencyStrategy } from './core/idempotency/store-idempotency.strategy';
export type { IdempotencyStore } from './core/idempotency/store-idempotency.strategy';

export { assertVersionCompatible } from './core/versioning/version-compatibility';
export { parseInboundEvent } from './sdk/consumer/parse-inbound-event';
export { traceContextFromEvent } from './core/tracing/trace-context';
export { decideDeliveryDisposition } from './core/dlq/delivery-decision';
export type { IdempotencyStrategy } from './core/idempotency/idempotency-strategy';
export { createSnsPublishEvent, type CreateSnsPublishEventOptions } from './sdk/publisher/create-sns-publish-event';
