// libs/event-platform/src/index.ts

export { consumeEvent } from './lib/event-platform';
export { createEventHandler } from './lib/create-event-handler';

export type { EventConsumerDeps } from './sdk/consumer/event-consumer';
export type { EventMetadata } from './core/event-envelope/base-event';
export type { RetryOptions } from './core/retry/retry';
export { DomainIdempotencyStrategy } from './core/idempotency/domain-idempotency.strategy';
 
export { assertVersionCompatible } from './core/versioning/version-compatibility';
export { parseInboundEvent } from './sdk/consumer/parse-inbound-event';
export { traceContextFromEvent } from './core/tracing/trace-context';
export { decideDeliveryDisposition } from './core/dlq/delivery-decision';
export type {IdempotencyStrategy} from './core/idempotency/idempotency-strategy';
