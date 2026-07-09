import { createChildLogger, createLogger } from '@api-hub/observability';
import { serializeError } from '@api-hub/observability';
import { BaseError, handleError, toBaseError } from '@api-hub/utils';

import { EventSchemaError } from './event-schema/event-schema-error';
import type { Middleware, MiddlewarePipelineEvent } from './types';

const baseLogger = createLogger({
  service: 'api-service',
  redactPII: true,
});

function normalizePipelineError(error: unknown): BaseError {
  if (error instanceof EventSchemaError) {
    const z = error.zodError;
    return new BaseError(
      error.message,
      400,
      'VALIDATION_ERROR',
      z.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
      { retryable: false },
    );
  }
  return toBaseError(error);
}

/**
 * HTTP API Gateway stack: outer catch normalizes errors, logs once, returns {@link APIGatewayProxyResult}.
 */
export function httpApiErrorMiddleware<
  TResult,
  TContext = unknown,
>(): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async ({ event, next }) => {
    try {
      return await next();
    } catch (error: unknown) {
      const raw = (event as MiddlewarePipelineEvent).__context;
      const correlationId = raw?.correlationId ?? 'unknown';
      const awsRequestId = raw?.awsRequestId ?? 'unknown-request-id';
      const logger = createChildLogger(baseLogger, {
        correlationId,
        awsRequestId,
      });

      const appError = normalizePipelineError(error);

      logger.error({
        event: 'http_pipeline_error',
        operation: raw?.operation,
        correlationId,
        traceId: raw?.traceId,
        'error.code': appError.code,
        'error.retryable': appError.retryable ?? false,
        err: serializeError(appError),
      });

      const response = await handleError(appError, {
        correlationId,
        logger,
        event,
        skipLog: true,
      });

      return response as TResult;
    }
  };
}

/**
 * Async / non-HTTP pipeline: normalize to {@link BaseError}, single structured log, rethrow.
 */
export function asyncErrorMiddleware<
  TResult = unknown,
  TContext = unknown,
>(): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  return async ({ event, next }) => {
    try {
      return await next();
    } catch (error: unknown) {
      const appError = normalizePipelineError(error);
      const raw = (event as MiddlewarePipelineEvent).__context;
      const correlationId = raw?.correlationId ?? 'unknown';
      const awsRequestId = raw?.awsRequestId ?? 'unknown-request-id';
      const logger = createChildLogger(baseLogger, {
        correlationId,
        awsRequestId,
      });

      logger.error({
        event: 'async_pipeline_error',
        operation: raw?.operation,
        correlationId,
        traceId: raw?.traceId,
        'error.code': appError.code,
        'error.retryable': appError.retryable ?? false,
        err: serializeError(appError),
      });

      throw appError;
    }
  };
}

/** @deprecated Use {@link asyncErrorMiddleware} or {@link httpApiErrorMiddleware}. */
export const errorMiddleware = asyncErrorMiddleware;
