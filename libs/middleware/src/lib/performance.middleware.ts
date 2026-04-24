import { logger, publishMiddlewarePipelineMetrics } from '@api-hub/observability';

import type { Middleware } from './types';

/**
 * Measures `next()` duration, logs structured timing, and emits Powertools EMF metrics
 * (`Latency`, `Success`, `Failure` counts) — no domain logic.
 *
 * Metrics namespace / service follow `POWERTOOLS_METRICS_NAMESPACE` and `POWERTOOLS_SERVICE_NAME`
 * (see `publishMiddlewarePipelineMetrics` in `@api-hub/observability`).
 */
export function performanceMiddleware<
  TResult = unknown,
  TContext = unknown,
>(operation: string): Middleware<unknown, TResult, TContext> {
  return async ({ next }) => {
    const startedAt = Date.now();

    try {
      const result = await next();
      const durationMs = Date.now() - startedAt;

      logger.info({
        event: 'middleware_performance',
        operation,
        durationMs,
        outcome: 'success',
      });

      publishMiddlewarePipelineMetrics({
        operation,
        durationMs,
        outcome: 'success',
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;

      logger.info({
        event: 'middleware_performance',
        operation,
        durationMs,
        outcome: 'failure',
      });

      publishMiddlewarePipelineMetrics({
        operation,
        durationMs,
        outcome: 'failure',
      });

      throw error;
    }
  };
}
