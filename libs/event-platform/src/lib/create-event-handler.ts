import { runMiddlewares } from '@api-hub/middleware';
import { buildEventExecutionPipeline } from '@api-hub/middleware';
import type {
  Handler,
  Middleware,
  MiddlewarePipelineEvent,
  PayloadSchemaRegistry,
} from '@api-hub/middleware';

import { consumeEvent } from './event-platform';
import type { BaseEvent } from '../core/event-envelope/base-event';
import type { EventMetadata } from '../core/event-envelope/base-event';
import { DomainIdempotencyStrategy } from '../core/idempotency/domain-idempotency.strategy';
import type { EventConsumerDeps } from '../sdk/consumer/event-consumer';

const idempotencyStrategy = new DomainIdempotencyStrategy();
const baseConsumerDeps: EventConsumerDeps = {
  idempotencyStrategy,
  retry: {
    maxAttempts: 3,
    strategy: 'exponential',
    delayMs: 200,
  },
  dlq: { enabled: true },
};

/**
 * Composes the standard event middleware stack and wraps the handler with
 * idempotency, payload validation, retry, and DLQ (via `consumeEvent`).
 */
export function createEventHandler<
  TEvent extends MiddlewarePipelineEvent,
  TResult = unknown,
  TContext = unknown,
>(
  options: {
    operation: string;
    payloadSchemas?: PayloadSchemaRegistry;
    mapRawToBaseEvent?: (raw: unknown) => BaseEvent<unknown>;
    /** Shallow-merged on top of platform defaults (idempotency, retry, etc.). */
    consumer?: Partial<EventConsumerDeps>;
  },
  handler: Handler<TEvent, TResult, TContext>,
): (event: TEvent, context: TContext) => Promise<TResult> {
  const mergedConsumerDeps: EventConsumerDeps = {
    ...baseConsumerDeps,
    ...options.consumer,
    ...(options.payloadSchemas !== undefined
      ? { payloadSchemas: options.payloadSchemas }
      : {}),
    ...(options.mapRawToBaseEvent !== undefined
      ? { mapRawToBaseEvent: options.mapRawToBaseEvent }
      : {}),
  };

  const wrappedHandler = consumeEvent(mergedConsumerDeps, async (payload: unknown, meta: EventMetadata) => {
    await handler(
      {
        ...(payload as object as TEvent),
        meta,
      } as TEvent,
      {} as TContext,
    );
  });

  const stack = buildEventExecutionPipeline<TResult, TContext>({
    operation: options.operation,
  }) as Array<Middleware<TEvent, TResult, TContext>>;

  return runMiddlewares(
    stack,
    wrappedHandler as unknown as Handler<TEvent, TResult, TContext>,
  );
}
