import type { z } from 'zod';

import { getConfig } from '@api-hub/observability';

import { contextMiddleware } from './context-middleware';
import { asyncErrorMiddleware, httpApiErrorMiddleware } from './error.middleware';
import { invocationContextMiddleware } from './invocation-context.middleware';
import { loggerMiddleware } from './logger.middleware';
import { performanceMiddleware } from './performance.middleware';
import { schemaValidationMiddleware } from './schema-validation.middleware';
import { getTracerForService } from './tracer-singleton';
import { tracerMiddleware } from './tracer.middleware';
import type { Middleware, MiddlewarePipelineEvent } from './types';
import { requestParserMiddleware } from './request-context.middleware';

/**
 * API Gateway / HTTP execution stack: error middleware is **first** in the array so it wraps the
 * whole inner chain ({@link runMiddlewares} nests index 0 as the outer caller). Order inside the
 * stack: error → context → invocation → logger → tracer → request parser → (optional) HTTP schema
 * → performance → handler.
 *
 * HTTP idempotency is **not** in this stack — use domain conditional writes in repositories/services.
 * Async consumer reliability (retry, DLQ, event idempotency) belongs in `@api-hub/event-platform`.
 */

export function buildApiExecutionPipeline<
  TResult = unknown,
  TContext = unknown,
>(options: {
  operation: string;
  schema?: z.ZodType<unknown>;
}) {
  const tracer = getTracerForService(getConfig().serviceName);

  const stack: Array<Middleware<MiddlewarePipelineEvent, TResult, TContext>> = [
    httpApiErrorMiddleware(),
    contextMiddleware(),
    invocationContextMiddleware({ operation: options.operation }),
    loggerMiddleware(),
    tracerMiddleware(tracer, {
      captureResponse: false,
      operation: options.operation,
    }),

    requestParserMiddleware(),
    schemaValidationMiddleware({ schema: options.schema }),
    performanceMiddleware(options.operation) as Middleware<
      MiddlewarePipelineEvent,
      TResult,
      TContext
    >,
  ];

  return stack;
}

/**
 * SQS / EventBridge / async execution stack: same as API but **no** HTTP request schema.
 */
export function buildEventExecutionPipeline<
  TResult = unknown,
  TContext = unknown,
>(options: { operation: string }): Array<
  Middleware<MiddlewarePipelineEvent, TResult, TContext>
> {
  const tracer = getTracerForService(getConfig().serviceName);
  return [
    asyncErrorMiddleware(),
    contextMiddleware(),
    invocationContextMiddleware({ operation: options.operation }),
    loggerMiddleware(),
    tracerMiddleware(tracer, {
      captureResponse: false,
      operation: options.operation,
    }),
    performanceMiddleware(options.operation),
  ];
}
