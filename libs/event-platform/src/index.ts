// libs/event-platform/src/index.ts

export { consumeEvent } from './lib/event-platform';
export { createEventHandler } from './lib/create-event-handler';
export { createStreamHandler } from './lib/create-stream-handler';
export { normalizeTransportToPayloadCandidate } from './sdk/consumer/transport-normalize';
export type { EventConsumerDeps, RetryOptions, RetryContext, RetryOnBeforeRetryInfo, RetryLogger, RetryBackoffStrategy, RetryJitter } from "./typings/consumer.types";
export type { EventPublisherDeps, CreateSnsPublishEventOptions, VersionCheckConfig, VersionCompatibilityStrategy, PublishInput } from "./typings/publisher.types";
export type { EventPublisher } from "./sdk/publisher/event-publisher";
export type { HandleOptions, HandleResult } from "./typings/publisher.types";


export type { BaseEvent, EventEnvelope, EventMeta } from './typings/base-event.types'; 
export type { EventConsumer } from './sdk/consumer/event-consumer'; 
export { DomainIdempotencyStrategy } from './core/idempotency/domain-idempotency.strategy';
export { StoreIdempotencyStrategy } from './core/idempotency/store-idempotency.strategy';
export type { IdempotencyStore } from './core/idempotency/store-idempotency.strategy';

export { assertVersionCompatible } from './core/versioning/version-compatibility';
export { parseInboundEvent } from './sdk/consumer/parse-inbound-event';
export { traceContextFromEvent } from './core/tracing/trace-context';
export { decideDeliveryDisposition } from './core/dlq/delivery-decision';
export type { IdempotencyStrategy } from './core/idempotency/idempotency-strategy';
export { createSnsPublishEvent,  } from './sdk/publisher/create-sns-publish-event';
export { defineEventHandler } from './lib/define-event-handler';
export type { EventSchemaMeta } from './core/schema/define-event-schema';
export { defineEventSchema } from './core/schema/define-event-schema';

