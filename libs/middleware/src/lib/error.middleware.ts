import { getLoggerContext, logger } from '@api-hub/observability';

import type { Middleware, MiddlewarePipelineEvent } from './types';

/**
 * JSON snapshot of the Lambda `event` for logs (handles circular structures).
 */
function snapshotEventPayload(value: unknown): unknown {
  const seen = new WeakSet<object>();
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) {
            return '[Circular]';
          }
          seen.add(v);
        }
        return v;
      }) as string
    ) as unknown;
  } catch {
    return { _error: 'event_payload_not_serializable' };
  }
}

/**
 * Catches all errors from `next()`, logs a structured record, then **re-throws**
 * (errors are never swallowed).
 * Uses `getLoggerContext()` and falls back to `event.__context` for `correlationId` / `awsRequestId`
 * and includes `eventPayload`. Place **outermost** in the standard stack so the catch wraps the chain.
 */
export function errorMiddleware<
  TResult = unknown,
  TContext = unknown,
>(): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async ({ event, next }) => {
    try {
      return await next();
    } catch (error) {
      const fromAls = getLoggerContext();
      let fromEventContext: { correlationId?: string; awsRequestId?: string } | undefined;
      if (event && typeof event === 'object' && (event as { __context?: unknown }).__context) {
        const c = (event as { __context: { correlationId?: string; awsRequestId?: string } }).__context;
        if (c && typeof c === 'object') {
          fromEventContext = c;
        }
      }
      const correlationId = fromAls.correlationId ?? fromEventContext?.correlationId;
      const awsRequestId = fromAls.awsRequestId ?? fromEventContext?.awsRequestId;

      logger.error({
        event: 'unhandled_middleware_error',
        correlationId,
        awsRequestId,
        eventPayload: snapshotEventPayload(event),
        err: error,
      });

      throw error;
    }
  };
}
