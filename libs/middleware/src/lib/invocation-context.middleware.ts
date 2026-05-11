import type { Middleware, MiddlewarePipelineEvent } from './types';

/**
 * Sets `event.__context.operation` (handler / route name). Run after `contextMiddleware` and
 * before `loggerMiddleware` so structured logs and tracing include the operation.
 */
export function invocationContextMiddleware<
  TResult = unknown,
  TContext = unknown,
>(options: { operation: string }): Middleware<
  MiddlewarePipelineEvent,
  TResult,
  TContext
> {
  return async ({ event, next }) => {
    const e = event as MiddlewarePipelineEvent;
    e.__context = { ...e.__context, operation: options.operation };
    return next();
  };
}
