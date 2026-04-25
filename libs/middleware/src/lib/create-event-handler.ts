import { runMiddlewares } from './middlewareEngine';
import { buildEventExecutionPipeline } from './http-pipeline';
import type { Handler, Middleware, MiddlewarePipelineEvent } from './types';

/**
 * Composes the lean **async / event-typed** execution stack (no HTTP request schema).
 * Pair with `consumeEvent` from `@api-hub/event-platform` for parse, idempotency, retry, and DLQ.
 */
export function createEventHandler<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  options: { operation: string },
  handler: Handler<TEvent, TResult, TContext>,
): (event: TEvent, context: TContext) => Promise<TResult> {
  const stack = buildEventExecutionPipeline<TResult, TContext>(options) as Array<
    Middleware<TEvent, TResult, TContext>
  >;
  return runMiddlewares(stack, handler);
}
