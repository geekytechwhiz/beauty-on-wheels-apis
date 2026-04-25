import type { z } from 'zod';

import { runMiddlewares } from './middlewareEngine';
import { buildApiExecutionPipeline } from './http-pipeline';
import type { Handler, Middleware, MiddlewarePipelineEvent } from './types';

/**
 * @deprecated Prefer {@link createApiHandler} for HTTP or {@link createEventHandler} for async consumers.
 */
export function createStandardLambdaHttpMiddlewares<
  TResult = unknown,
  TContext = unknown,
>(options: {
  serviceName?: string;
  operation: string;
  /** Zod schema for the full API Gateway / Lambda `event`; omit when no request validation. */
  schema?: z.ZodType<unknown>;
}): Array<Middleware<MiddlewarePipelineEvent, TResult, TContext>> {
  return buildApiExecutionPipeline<TResult, TContext>({
    operation: options.operation,
    schema: options.schema,
  });
}

type ApiGatewayishHandler<TEvent, TResult, TContext> = Handler<TEvent, TResult, TContext>;

/**
 * AWS Lambda handler wrapper using the standard **HTTP** execution pipeline.
 */
export function withStandardApiGatewayPipeline<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  operation: string,
  businessHandler: ApiGatewayishHandler<TEvent, TResult, TContext>,
  options?: { serviceName?: string; schema?: z.ZodType<unknown> },
): (event: TEvent, context: TContext) => Promise<TResult> {
  return runMiddlewares(
    createStandardLambdaHttpMiddlewares<TResult, TContext>({
      serviceName: options?.serviceName,
      operation,
      schema: options?.schema,
    }) as Array<Middleware<TEvent, TResult, TContext>>,
    businessHandler,
  );
}
