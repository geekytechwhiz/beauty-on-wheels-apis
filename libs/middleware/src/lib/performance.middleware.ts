import { BaseError, errorCodeFromUnknown } from '@api-hub/utils';

import { createLogger, publishMiddlewarePipelineMetrics } from '@api-hub/observability';

import type { Middleware } from './types';
import { ensureObservabilityInitialized } from './observability-init';

ensureObservabilityInitialized();

const logger = createLogger();

/**
 * Measures `next()` duration, logs structured timing, and emits Powertools EMF metrics
 * (`Latency`, `Success`, `Failure` counts) — no domain logic.
 *
 * Metrics namespace and service name come from `initObservability` (see `ensureObservabilityInitialized`).
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
        message: 'Middleware pipeline timing',
        logType: 'middleware_performance',
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
      const retryable =
        error instanceof BaseError ? (error.retryable ?? false) : undefined;

      logger.info({
        event: 'middleware_performance',
        message: 'Middleware pipeline timing',
        logType: 'middleware_performance',
        operation,
        durationMs,
        outcome: 'failure',
        errorCode: errorCodeFromUnknown(error),
        ...(retryable !== undefined ? { 'error.retryable': retryable } : {}),
      });

      publishMiddlewarePipelineMetrics({
        operation,
        durationMs,
        outcome: 'failure',
        errorCode: errorCodeFromUnknown(error),
        retryable,
      });

      throw error;
    }
  };
}
