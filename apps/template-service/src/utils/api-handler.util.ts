import {
  buildApiExecutionPipeline,
  buildRequestContext,
  runMiddlewares,
  type withApiHandlerOptions,
  type ApiHandler,
  type MiddlewarePipelineEvent,
} from '@api-hub/middleware';
import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
} from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import type { APIGatewayProxyResult } from 'aws-lambda';

/** Returned from handlers that should respond with HTTP 204 (e.g. enablement REVOKE). */
export const HTTP_NO_CONTENT = Symbol('HTTP_NO_CONTENT');

const baseLogger = createLogger({
  service: 'api-service',
  redactPII: true,
});

function awsRequestIdFromLambdaContext(lambdaContext: unknown): string {
  if (
    lambdaContext &&
    typeof lambdaContext === 'object' &&
    'awsRequestId' in lambdaContext
  ) {
    return extractAwsRequestId(lambdaContext as { awsRequestId: string });
  }
  return 'unknown-request-id';
}

/**
 * Same as {@link withApiHandler}, but allows the handler to return {@link HTTP_NO_CONTENT} for 204 responses.
 */
export function withApiHandlerOrNoContent<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  options: withApiHandlerOptions,
  handler: ApiHandler<ReturnType<typeof buildRequestContext>, TResult | typeof HTTP_NO_CONTENT>,
) {
  const stack = buildApiExecutionPipeline<TResult, TContext>({
    operation: options.operation,
    schema: options.schema,
  });

  const adaptedHandler = async (event: TEvent, lambdaContext: TContext): Promise<TResult> => {
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

    const req = buildRequestContext(event as Parameters<typeof buildRequestContext>[0]);
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

    const result = await handler(req);

    if (result === HTTP_NO_CONTENT) {
      return {
        statusCode: 204,
        headers: { 'Content-Type': 'application/json' },
        body: '',
      } as TResult;
    }

    const correlationIdFromContext =
      (req.context as { correlationId?: string }).correlationId ?? 'unknown';

    return ApiResponse.ok(result, {
      title: 'SUCCESS',
      description: 'Request processed successfully',
      severity: 'SUCCESS',
    }, {
      correlationId: correlationIdFromContext,
    }) as TResult;
  };

  return runMiddlewares(stack, adaptedHandler);
}
