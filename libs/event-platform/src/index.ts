// libs/event-platform/src/index.ts

export { 
  onEvent,
  type CreateEventHandlerOptions,
  type OnEventOptions,
} from './lib/create-event-handler';
export { 
  correlationHintFromEventBridge,
} from './lib/event-bridge-per-message-context';
   
export {
  createDynamoStreamHandler, 
} from './lib/create-dynamo-stream-handler';
export { onDynamoEvent } from './lib/on-dynamo-event'; 
export { 
  unwrapSnsNotificationPayload,
} from './sdk/consumer/transport-normalize';
export type { EventConsumerDeps, RetryOptions, RetryContext, RetryOnBeforeRetryInfo, RetryLogger, RetryBackoffStrategy, RetryJitter } from "./typings/consumer.types";
export type { EventPublisherDeps,   VersionCheckConfig, VersionCompatibilityStrategy } from "./typings/publisher.types";
export type { HandleOptions, HandleResult } from "./typings/publisher.types";


export type { BaseEvent, EventEnvelope, EventMeta } from './typings/base-event.types';
export type { IdempotencyStore } from './core/idempotency/store-idempotency.strategy';
export { DynamoDbIdempotencyStore } from './infra/dynamodb-idempotency-store';
export { recommendedSqsRedriveMaxReceiveCount } from './infra/recommended-sqs-redrive-max-receive-count';
export { 
  createDefaultSqsDlqStrategy,
  type SqsRedrivePolicyFragment,
  type ValidateConsumerDlqConfigOptions,
} from './infra/dlq-integration'; 
 
export type {
  FifoBatchTailDeferredContext,
  EventTracingHooks,
} from './core/tracing/event-tracing-hooks';
export { fireFifoBatchTailDeferred } from './core/tracing/event-tracing-hooks';
 
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
export {
  configureEventPlatform,
  type ConfigureEventPlatformOptions,
} from './dx/configure-event-pladtform';
export type { PublishRoutingConfig, PublishPlan } from './publishing/routing';
 
 
 
export { classifyFailure, isNonRetryableFailure } from './reliability/failure-classifier';
export {
  registerEventDefinition,
  getRegisteredEventDefinition,
  listRegisteredEventDefinitions,
  type RegisteredEventDefinition,
  type EventClassification,
} from './governance/event-registry';
export { enforceRegisteredEventCompatibility } from './governance/schema-compatibility';
export type { ReplayMetadata } from './governance/replay-metadata';
