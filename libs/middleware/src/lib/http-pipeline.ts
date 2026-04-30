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
 * stack: error → context → invocation → logger → tracer → (optional) HTTP schema → performance → handler.
 *
 * Reliability (idempotency, event payload schemas, retry, DLQ) belongs in `@api-hub/event-platform`, not here.
 */



export function buildApiExecutionPipeline<
  TResult = unknown,
  TContext = unknown,
>(options: {
  operation: string;
  schema?: z.ZodType<unknown>;
}) {
  const tracer = getTracerForService(getConfig().serviceName);

  return [
    httpApiErrorMiddleware(),
    contextMiddleware(),
    invocationContextMiddleware({ operation: options.operation }),
    loggerMiddleware(),
    tracerMiddleware(tracer, {
      captureResponse: false,
      operation: options.operation,
    }),

    requestParserMiddleware(),                    // 🔥 critical
    schemaValidationMiddleware({ schema: options.schema }),

    performanceMiddleware(options.operation),
  ];
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
