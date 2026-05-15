import type { z } from 'zod';

import type { MiddlewarePipelineEvent } from '@api-hub/middleware';

import { createConsumerRuntime } from '../runtime/create-consumer-runtime';
import type { EventHandlerEntry } from '../runtime/build-event-registry';
import type { OperationName } from '../runtime/middleware-compose';
import { eventBridgeTransportProfile } from '../transports/eventbridge/profile';
import type { EventConsumerDeps } from '../typings/consumer.types';

export type CreateEventHandlerOptions<
  TEvent extends MiddlewarePipelineEvent,
  TContext = unknown,
> = {
  operation: OperationName;
  consumer?: Partial<EventConsumerDeps>;
  events: EventHandlerEntry<z.ZodTypeAny>[];
};

export function createEventHandler<
  TEvent extends MiddlewarePipelineEvent,
  TContext = unknown,
>(
  options: CreateEventHandlerOptions<TEvent, TContext>,
): (event: TEvent, context: TContext) => Promise<void> {
  return createConsumerRuntime<TEvent, void, TContext>({
    operation: options.operation,
    profile: eventBridgeTransportProfile,
    events: options.events,
    consumer: options.consumer,
  });
}
