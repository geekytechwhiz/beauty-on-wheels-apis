import { requireServiceName } from '@api-hub/observability';
import type { z } from 'zod';

import { contextMiddleware } from './context-middleware';
import { errorMiddleware } from './error.middleware';
import { invocationContextMiddleware } from './invocation-context.middleware';
import { loggerMiddleware } from './logger.middleware';
import { performanceMiddleware } from './performance.middleware';
import { schemaValidationMiddleware } from './schema-validation.middleware';
import { getTracerForService } from './tracer-singleton';
import { tracerMiddleware } from './tracer.middleware';
import type { Middleware, MiddlewarePipelineEvent } from './types';

/**
 * API Gateway / HTTP execution stack: error → context → invocation → logger →
 * tracer → (optional) HTTP request schema → performance → handler.
 * Reliability (idempotency, event payload schemas, retry, DLQ) belongs in `@api-hub/event-platform`, not here.
 */
export function buildApiExecutionPipeline<
  TResult = unknown,
  TContext = unknown,
>(options: {
  operation: string;
  /** Optional Zod schema for the **full** Lambda / API Gateway `event` object. */
  schema?: z.ZodType<unknown>;
}): Array<Middleware<MiddlewarePipelineEvent, TResult, TContext>> {
  const service = requireServiceName();
  const tracer = getTracerForService(service);
  return [
    errorMiddleware(),
    contextMiddleware(),
    invocationContextMiddleware({ operation: options.operation }),
    loggerMiddleware(),
    tracerMiddleware(tracer, {
      captureResponse: false,
      operation: options.operation,
    }),
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
  const service = requireServiceName();
  const tracer = getTracerForService(service);
  return [
    errorMiddleware(),
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
