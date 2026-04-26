import { applyStandardEventContext } from './standard-event-context';
import type { Middleware, MiddlewareParams, MiddlewarePipelineEvent } from './types';

/**
 * Fills `event.__context` with correlation, Lambda request id, and transport hints
 * (`source`, `eventType`) for HTTP, EventBridge, and SQS. Does not set those fields
 * on the event root.
 */
export function contextMiddleware<
  TResult = unknown,
  TContext = unknown,
>(): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async ({
    event,
    context,
    next,
  }: MiddlewareParams<MiddlewarePipelineEvent, TResult, TContext>) => {
    
    applyStandardEventContext(event, context);
    return next();
  };
}
