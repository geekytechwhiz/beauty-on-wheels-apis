// libs/event-platform/src/index.ts

export { 
  onEvent,
  type CreateEventHandlerOptions,
  type OnEventOptions,
} from './lib/create-event-handler';
export {
  onQueue,
  createSqsEventHandler,
  type CreateSqsEventHandlerOptions,
  type OnQueueOptions,
} from './lib/create-sqs-event-handler';
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
export { SqsAdapter } from './adapters/sqs/sqs-adapter';
export type { SqsAdapterConfig } from './adapters/sqs/sqs-adapter-config';
export { EventPublisher } from './sdk/publisher/event-publisher';
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

export type { RealtimeConsumerConfig } from './core/realtime/interfaces/realtime-config.interface';
export type { RealtimePublisher } from './core/realtime/interfaces/realtime-publisher.interface';
export type { RecipientResolver } from './core/realtime/interfaces/recipient-resolver.interface';
export type { EventTransformer } from './core/realtime/interfaces/event-transformer.interface';
export type { RealtimeMessage } from './core/realtime/types/realtime-message.type';
export type { RealtimeRecipient } from './core/realtime/types/realtime-recipient.type';
export type { RealtimeAggregateMessage } from './core/realtime/types/realtime-aggregate-message.type';
export {
  RealtimeAggregateEventSchema,
  RealtimeAggregatePayloadSchema,
  REALTIME_AGGREGATE_EVENT_TYPE,
} from './core/realtime/schemas/realtime-aggregate.event';
export { RealtimeEventService } from './core/realtime/services/realtime-event.service'; 
export type { SocketService, SocketPublishContext } from './core/realtime/interfaces/socket-service.interface';
export type { ConnectionResolver } from './core/realtime/interfaces/connection-resolver.interface';
export { buildSocketDestinationKey, type SocketDestinationInput } from './core/realtime/utils/build-socket-destination-key';
export { deriveSocketDestinations } from './core/realtime/utils/derive-socket-destinations';
export {
  deriveConnectDestinations,
  parseCommaSeparatedList,
} from './core/realtime/utils/derive-connect-destinations';
export type { ConnectionStore } from './core/realtime/interfaces/connection-store.interface';
export {
  DynamoDbConnectionStore,
  createDynamoDbConnectionStore,
  type DynamoDbConnectionStoreOptions,
} from './core/realtime/infra/dynamodb-connection-store';
export { connectionPk, connectionSk } from './core/realtime/infra/connection-keys';
export { DynamoDbConnectionResolver } from './core/realtime/services/dynamodb-connection-resolver.service';
export {
  resolveConnectionStore,
  resetConnectionStoreCache,
} from './core/realtime/services/resolve-connection-store';
export {
  ApiGatewaySocketService,
  type ApiGatewaySocketServiceOptions,
} from './core/realtime/services/api-gateway-socket.service';
export { SocketRealtimePublisher } from './core/realtime/publishers/socket-realtime-publisher.service';
export {
  resolveConnectionResolver,
  resetConnectionResolverCache,
} from './core/realtime/services/resolve-connection-resolver';
export {
  createWebSocketConnectHandler,
  createWebSocketDisconnectHandler,
  websocketConnectHandler,
  websocketConnectMain,
  websocketDisconnectHandler,
  websocketDisconnectMain,
  type WebSocketConnectHandlerOptions,
  type WebSocketConnectContextInput,
  type WebSocketDisconnectHandlerOptions,
} from './handlers/websocket-connection.handler';
export {
  resolveSocketService,
  resetSocketServiceCache,
  isRealtimeSocketEnabled,
} from './core/realtime/services/resolve-socket-service';
export {
  resolveSocketRealtimePublisher,
  resetSocketRealtimePublisherCache,
} from './core/realtime/services/resolve-socket-realtime-publisher';
export { RealtimeAggregationService } from './core/realtime/services/realtime-aggregation.service';
export {
  RealtimeAggregationPublisher,
  createRealtimeAggregationPublisher,
  type RealtimeAggregationPublisherOptions,
} from './core/realtime/publishers/realtime-aggregation.publisher';
export {
  createRealtimeAggregationConsumer,
  createDefaultRealtimeAggregationConsumer,
  createDefaultRealtimeAggregationConsumerOptions,
  type CreateRealtimeAggregationConsumerOptions,
} from './core/realtime/consumers/realtime-aggregation.consumer';
export {
  handler as realtimeAggregationSqsHandler,
  main as realtimeAggregationSqsMain,
} from './handlers/realtime-aggregation-sqs.handler';
export {
  ALERT_EVENT_OPERATIONS,
  ALERT_REALTIME_EVENTS,
  ALERT_REALTIME_EVENT_VERSION,
} from './core/contracts/alert.events';
export type { RealtimeSocketEnvelope } from './core/realtime/types/realtime-socket-envelope.type';