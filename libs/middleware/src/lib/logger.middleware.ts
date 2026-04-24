import { withLoggerContext, type LoggerContext } from '@api-hub/observability';

import type { Middleware, MiddlewarePipelineEvent } from './types';

/**
 * Maps `event.__context` (set by upstream context middleware) to {@link LoggerContext}.
 * Read-only: does not mutate `event` or the shared logger.
 */
function loggerContextFromEvent(
  event: MiddlewarePipelineEvent
): LoggerContext {
  const raw = event.__context;
  if (raw == null || typeof raw !== 'object') {
    return {};
  }
  return { ...raw } as LoggerContext;
}

/**
 * Binds `event.__context` into observability’s AsyncLocalStorage via {@link withLoggerContext}.
 * Downstream `logger` calls from `@api-hub/observability` pick up `correlationId` and other fields
 * through the observability store (see `getLoggerContext` in `@api-hub/observability`) —
 * no per-call `correlationId` is required.
 *
 * Wraps the **entire** remainder of the chain (`next()`) in the same context, including async work.
 * Run **after** middleware that attaches `event.__context` (e.g. `contextMiddleware`).
 */
export function loggerMiddleware<
  TResult = unknown,
  TContext = unknown,
>(): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async ({ event, next }) => {
    const ctx = loggerContextFromEvent(event);
    return withLoggerContext(ctx, async () => {
      return await next();
    });
  };
}
