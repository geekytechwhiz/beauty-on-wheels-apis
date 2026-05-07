import type { Context } from 'aws-lambda';
import type { z } from 'zod';

import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
} from '@api-hub/logger';

import { runMiddlewares } from './middlewareEngine';
import { buildApiExecutionPipeline } from './http-pipeline';
import { buildRequestContext } from './request-context.middleware';
import type {
  Middleware,
  MiddlewarePipelineEvent,
  RequestBuildEvent,
} from './types';
import { successResponse } from './response.middleware';
import { LambdaRequest } from '@api-hub/utils';

const baseLogger = createLogger({
  service: 'api-service',
  redactPII: true,
});
export type ApiHandler<TReq, TResult> = (
  req: TReq
) => Promise<TResult>;
type RequestValidator = (
  req: LambdaRequest

) => void | Promise<void>;
export type   withApiHandlerOptions = {
  operation: string;
  /** Validates the full Lambda/API Gateway `event` (runs in HTTP schema middleware). */
  schema?: z.ZodType<unknown>;
  /**
   * Validates `req.body` after {@link buildRequestContext} (typical for JSON HTTP APIs).
   * Runs after logger/correlation are attached to `req.context`.
   */
  bodySchema?: z.ZodType<unknown>;
  /**
   * Optional request-level validation (e.g. tenant resolution) after body parsing.
   */
  validator?:RequestValidator
};

function awsRequestIdFromLambdaContext(lambdaContext: unknown): string {
  if (
    lambdaContext &&
    typeof lambdaContext === 'object' &&
    'awsRequestId' in lambdaContext
  ) {
    return extractAwsRequestId(lambdaContext as Context);
  }
  return 'unknown-request-id';
}

/**
 * Composes the standard HTTP middleware chain and returns a Lambda handler that builds
 * {@link buildRequestContext}, attaches a **child logger** (same as {@link withLambdaHandler}),
 * optionally validates the body, runs `validator`, then invokes `handler(req)`.
 *
 * `requestParserMiddleware` runs before this adapter so `event.body` is typically already parsed.
 */
export function withApiHandler<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  options: withApiHandlerOptions,
  handler: ApiHandler<
    ReturnType<typeof buildRequestContext>,
    TResult
  >,
) {
  const stack = buildApiExecutionPipeline<TResult, TContext>({
    operation: options.operation,
    schema: options.schema,
  }) as Array<Middleware<TEvent, TResult, TContext>>;

  const adaptedHandler = async (
    event: TEvent,
    lambdaContext: TContext,
  ): Promise<TResult> => {
    const pipelineEvent = event as MiddlewarePipelineEvent;
    const std = pipelineEvent.__context;

    const correlationId =
      std?.correlationId ?? awsRequestIdFromLambdaContext(lambdaContext);

    const awsRequestId =
      std?.awsRequestId ?? awsRequestIdFromLambdaContext(lambdaContext);

    const logger = createChildLogger(baseLogger, {
      correlationId,
      awsRequestId,
    });

    const req = buildRequestContext(event as unknown as RequestBuildEvent);
    const ctxFields = {
      ...(req.context as unknown as Record<string, unknown>),
      logger,
      correlationId,
      awsRequestId,
      traceId: std?.traceId,
      operation: std?.operation,
    };
    (req as unknown as { context: Record<string, unknown> }).context =
      Object.freeze(ctxFields);

    if (options.bodySchema !== undefined) {
      req.body = options.bodySchema.parse(req.body) as typeof req.body;
    }

    if (options.validator !== undefined) {
      await options.validator(req);
    }

    const handleHandler = async (req: ReturnType<typeof buildRequestContext>) => {
      return await handler(req);
    };
    const result = await handleHandler(req);

    const correlationIdFromContext =
      (req.context as { correlationId?: string }).correlationId ?? 'unknown';
     
    return successResponse(result, undefined, { correlationId :correlationIdFromContext}) as TResult;
  };

  return runMiddlewares(stack, adaptedHandler) 
}
