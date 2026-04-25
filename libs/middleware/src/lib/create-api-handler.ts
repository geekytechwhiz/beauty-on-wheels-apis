import type { z } from 'zod';

import { runMiddlewares } from './middlewareEngine';
import { buildApiExecutionPipeline } from './http-pipeline';
import type { Handler, Middleware, MiddlewarePipelineEvent } from './types';

/**
 * Composes the standard **HTTP** middleware chain and returns a Lambda handler.
 * Use `schema` to validate the incoming `event` (e.g. API Gateway shape). Domain event schemas
 * and idempotency belong in `@api-hub/event-platform`.
 */
export function createApiHandler<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  options: { operation: string; schema?: z.ZodType<unknown> },
  handler: Handler<TEvent, TResult, TContext>,
): (event: TEvent, context: TContext) => Promise<TResult> {
  const stack = buildApiExecutionPipeline<TResult, TContext>(options) as Array<
    Middleware<TEvent, TResult, TContext>
  >;
  return runMiddlewares(stack, handler);
}
