import { withLoggerContext, type LoggerContext } from '@api-hub/observability';

import type { Middleware, MiddlewarePipelineEvent } from './types';

/**
 * Binds `event.__context` into observability AsyncLocalStorage. Does not set reserved logger keys;
 * `service` is supplied by the Powertools logger from `SERVICE_NAME`, not from middleware.
 */
function loggerContextFromEvent(
  event: MiddlewarePipelineEvent,
): LoggerContext {
  const raw = event.__context;
  if (raw == null || typeof raw !== 'object') {
    return {};
  }
  return { ...raw } as LoggerContext;
}

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
