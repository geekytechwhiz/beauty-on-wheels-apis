// libs/event-platform/src/index.ts

export { consumeEvent } from './lib/event-platform';
export { onEvent } from './lib/define-event-handler';
export { createStreamHandler } from './lib/create-stream-handler';
export { normalizeTransportToPayloadCandidate } from './sdk/consumer/transport-normalize';
export type { EventConsumerDeps, RetryOptions, RetryContext, RetryOnBeforeRetryInfo, RetryLogger, RetryBackoffStrategy, RetryJitter } from "./typings/consumer.types";
export { effectiveTransportMode } from './typings/consumer.types';
export type { EventPublisherDeps, CreateSnsPublishEventOptions, VersionCheckConfig, VersionCompatibilityStrategy, PublishInput } from "./typings/publisher.types";
export type { EventPublisher } from "./sdk/publisher/event-publisher";
export type { HandleOptions, HandleResult } from "./typings/publisher.types";


export type { BaseEvent, EventEnvelope, EventMeta } from './typings/base-event.types';
export { EventConsumer } from './sdk/consumer/event-consumer';
export { DomainIdempotencyStrategy } from './core/idempotency/domain-idempotency.strategy';
export { StoreIdempotencyStrategy } from './core/idempotency/store-idempotency.strategy';
export type { IdempotencyStore } from './core/idempotency/store-idempotency.strategy';
export { DynamoDbIdempotencyStore } from './infra/dynamodb-idempotency-store';
export { InMemoryIdempotencyStore } from './infra/in-memory-idempotency-store';
export { recommendedSqsRedriveMaxReceiveCount } from './infra/recommended-sqs-redrive-max-receive-count';
export {
  createIdempotencyStrategy,
  type CreateIdempotencyStrategyOptions,
} from './core/idempotency/idempotency-factory';

export { assertVersionCompatible } from './core/versioning/version-compatibility';
export { parseInboundEvent } from './sdk/consumer/parse-inbound-event';
export { traceContextFromEvent } from './core/tracing/trace-context';
export {
  classifyAfterHandlerFailure,
  decideDeliveryDisposition,
  evaluateDeliveryPolicy,
  isNonRetryableHandlerError,
  outcomeWhenExhausted,
  resolveDeliveryDecision,
} from './core/dlq/delivery-decision';
export type {
  DecideDeliveryDisposition,
  DeliveryDecision,
  EvaluateDeliveryPolicyParams,
  ResolveDeliveryDecisionParams,
  TransportMode,
} from './core/dlq/delivery-decision';
export type { IdempotencyStrategy } from './core/idempotency/idempotency-strategy';
export { IdempotencyState, idempotencyBeforeResultToState } from './core/idempotency/idempotency-state';
export { createSnsPublishEvent } from './sdk/publisher/create-sns-publish-event';
export type { EventSchemaMeta } from './core/schema/define-event';
export { defineEvent } from './core/schema/define-event';
export { publishEvent } from './dx/publish-event'; 
export { EventBridgeAdapter } from './adapters/eventbridge/eventbridge-adapter';
export { configureEventPlatform, type ConfigureEventPlatformOptions } from './dx/configure-event-pladtform';
