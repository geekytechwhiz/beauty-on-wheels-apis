// libs/event-platform/src/index.ts

export { consumeEvent } from './lib/event-platform';
export {
  createSqsEventHandler,
  type CreateSqsEventHandlerOptions,
  type CreateSqsEventHandlerVisibilityHeartbeat,
} from './lib/create-sqs-event-handler';
export {
  resolveSqsVisibilityHeartbeatConfig,
  runWithSqsVisibilityHeartbeat,
  SqsVisibilityHeartbeatController,
} from './sqs/sqs-visibility-heartbeat';
export type {
  SqsVisibilityHeartbeatConfig,
  SqsVisibilityHeartbeatHooks,
  SqsVisibilityHeartbeatStopReason,
} from './sqs/sqs-visibility-heartbeat';
export {
  approximateReceiveCountFromSqsRecord,
  buildSqsPerMessageLoggerContext,
  correlationHintFromSqsRecord,
  getSqsRecordShape,
  sqsRecordFifoMetadata,
} from './lib/sqs-per-message-context';
export type {
  ConsumeEventOptions,
  ConsumeEventWrapProcessSingle,
} from './engine/executor/consume-event';
export {
  partitionSqsBatchBySchedulingLane,
  runFifoAwareSqsBatchProcess,
  sqsFifoSchedulingLaneKey,
} from './engine/processor/sqs-fifo-group-scheduler';
export type { FifoLanePartition } from './engine/processor/sqs-fifo-group-scheduler';
export type { ProcessBatchOptions } from './engine/processor/process-batch';
export {
  buildBaseEventFromNormalizedStream,
  createDynamoStreamMapRawToBaseEvent,
  matchDynamoStreamEventName,
  matchDynamoStreamRoute,
  matchDynamoStreamTable,
} from './dynamo-stream/map-dynamo-stream-record';
export type {
  DynamoStreamEventNameFilter,
  DynamoStreamRoute,
} from './dynamo-stream/map-dynamo-stream-record';
export {
  buildDynamoStreamPerMessageLoggerContext,
  getDynamoStreamRecordShape,
} from './dynamo-stream/dynamo-stream-per-message-context';
export {
  isDynamoDbStreamRecord,
  normalizeDynamoStreamRecord,
  tableNameFromDynamoStreamArn,
} from './dynamo-stream/normalize-dynamo-stream-record';
export type { NormalizedDynamoStreamEvent } from './dynamo-stream/normalized-dynamo-stream-event';
export { StreamRecordFilteredError } from './dynamo-stream/stream-record-filtered.error';
export { onEvent } from './lib/define-event-handler';
export {
  createDynamoStreamHandler,
  type CreateDynamoStreamHandlerEventEntry,
  type CreateDynamoStreamHandlerOperationName,
  type CreateDynamoStreamHandlerOptions,
  type DynamoStreamBatchResponse,
} from './lib/create-dynamo-stream-handler';
export { onDynamoEvent } from './lib/on-dynamo-event';
export { createStreamHandler } from './lib/create-stream-handler';
export {
  normalizeTransportToPayloadCandidate,
  unwrapSnsNotificationPayload,
} from './sdk/consumer/transport-normalize';
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
export type {
  FifoBatchTailDeferredContext,
  EventTracingHooks,
} from './core/tracing/event-tracing-hooks';
export { fireFifoBatchTailDeferred } from './core/tracing/event-tracing-hooks';
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
