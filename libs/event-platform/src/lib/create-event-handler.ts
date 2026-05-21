import type { z } from 'zod';

import type { LambdaInvocationContext, MiddlewarePipelineEvent } from '@api-hub/middleware';

import {
  createConsumerRuntime,
  createPerRecordLoggerConsumeOptions,
} from '../runtime/create-consumer-runtime';
import type { EventHandlerEntry } from '../runtime/build-event-registry';
import type { OperationName } from '../runtime/middleware-compose';
import type { RealtimeConsumerConfig } from '../core/realtime/interfaces/realtime-config.interface';
import type { EventConsumerDeps } from '../typings/consumer.types';
import { eventBridgeTransportProfile } from '../transports/eventbridge/profile';

export type CreateEventHandlerOptions<
  TEvent extends MiddlewarePipelineEvent = MiddlewarePipelineEvent,
  TContext = unknown,
> = {
  operation: OperationName;
  consumer?: Partial<EventConsumerDeps>;
  /** Optional realtime fan-out after successful handler execution. */
  realtime?: RealtimeConsumerConfig;
  events: EventHandlerEntry<z.ZodTypeAny>[];
};

/** Preferred name for EventBridge Lambda consumers (alias of {@link createEventHandler}). */
export type OnEventOptions<
  TEvent extends MiddlewarePipelineEvent = MiddlewarePipelineEvent,
  TContext = unknown,
> = CreateEventHandlerOptions<TEvent, TContext>;

/**
 * Lambda handler factory for **EventBridge** using the same runtime as SQS:
 * transport profile, outcome mapping, per-event ALS.
 */
export function createEventHandler<
  TEvent extends MiddlewarePipelineEvent = MiddlewarePipelineEvent,
  TContext = unknown,
>(
  options: CreateEventHandlerOptions<TEvent, TContext>,
): (event: TEvent, context: TContext) => Promise<void> {
  return createConsumerRuntime<TEvent, void, TContext>({
    operation: options.operation,
    profile: eventBridgeTransportProfile,
    events: options.events,
    consumer: options.consumer,
    realtime: options.realtime,
    consumeOptions: (lambdaContext) =>
      createPerRecordLoggerConsumeOptions(
        eventBridgeTransportProfile,
        options.operation,
        lambdaContext as LambdaInvocationContext,
      ),
  });
}

/** Alias for {@link createEventHandler} — explicit EventBridge naming. */
export const createEventBridgeEventHandler = createEventHandler;

/** Preferred DX name for EventBridge Lambda consumers. Same as {@link createEventHandler}. */
export const onEvent = createEventHandler;
