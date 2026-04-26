import { runMiddlewares } from '@api-hub/middleware';
import { buildEventExecutionPipeline } from '@api-hub/middleware';
import type { Handler, Middleware, MiddlewarePipelineEvent, PayloadSchemaRegistry } from '@api-hub/middleware';

import { consumeEvent } from './event-platform';
import type { EventConsumerDeps } from '../sdk/consumer/event-consumer';
import type { EventMetadata } from '../core/event-envelope/base-event';
import { DomainIdempotencyStrategy } from 'src/core/idempotency/domain-idempotency.strategy';

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
    payloadSchemas:   PayloadSchemaRegistry;
  },
  handler: Handler<TEvent, TResult, TContext>,
): (event: TEvent, context: TContext) => Promise<TResult> {

  const mergedConsumerDeps = {
    ...baseConsumerDeps,
    ...options.payloadSchemas,
  };
  const wrappedHandler = consumeEvent(mergedConsumerDeps, async (payload: unknown, meta: EventMetadata): Promise<void> => {
    await handler(
      {
        ...(payload as unknown as TEvent),
        meta,
      },
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
