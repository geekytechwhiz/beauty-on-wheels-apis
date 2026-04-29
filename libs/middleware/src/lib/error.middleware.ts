import { createLogger } from '@api-hub/observability';

import type { Middleware, MiddlewarePipelineEvent } from './types';
import { ensureObservabilityInitialized } from './observability-init';

ensureObservabilityInitialized();

const logger = createLogger();

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
 * Catches all errors from `next()`, logs, then re-throws. Placed **first** in the array so
 * this middleware wraps the entire inner chain. Because the outer `catch` may run outside
 * AsyncLocalStorage, we merge `event.__context` for correlation and trace fields.
 */
export function errorMiddleware<
  TResult = unknown,
  TContext = unknown,
>(): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async ({ event, next }) => {
    try {
      return await next();
    } catch (error) {
      const raw = (event as MiddlewarePipelineEvent).__context;
      const bridge =
        raw && typeof raw === 'object'
          ? {
              correlationId: raw.correlationId,
              awsRequestId: raw.awsRequestId,
              traceId: raw.traceId,
            }
          : undefined;

      logger.error('Unhandled error in middleware pipeline', {
        event: 'unhandled_middleware_error',
        eventPayload: snapshotEventPayload(event),
        err: error,
        ...bridge,
      });

      throw error;
    }
  };
}
