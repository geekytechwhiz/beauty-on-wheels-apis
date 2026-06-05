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
import { ApiResponse, type LambdaRequest, type Message } from '@api-hub/utils';
import type { APIGatewayProxyResult } from 'aws-lambda';

import { TEMPLATE_API_MESSAGES } from './template-api-messages';

/** Returned from handlers that should respond with HTTP 204 (e.g. enablement REVOKE). */
export const HTTP_NO_CONTENT = Symbol('HTTP_NO_CONTENT');

const baseLogger = createLogger({
  service: 'template-service',
  redactPII: true,
});

export type TemplateApiHandlerOptions = withApiHandlerOptions & {
  /** Overrides the default message from {@link TEMPLATE_API_MESSAGES} for this operation. */
  successMessage?: Message;
  /** When true, respond with HTTP 201. */
  useCreated?: boolean;
  /** Dynamic success message (e.g. create vs update on same route). */
  resolveSuccessMessage?: (
    req: LambdaRequest,
    result: unknown,
  ) => Message | undefined;
};

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

function resolveMessage(
  options: TemplateApiHandlerOptions,
  req: LambdaRequest,
  result: unknown,
): Message {
  const dynamic = options.resolveSuccessMessage?.(req, result);
  if (dynamic) return dynamic;
  if (options.successMessage) return options.successMessage;
  return (
    TEMPLATE_API_MESSAGES[options.operation] ?? {
      title: 'SUCCESS',
      description: 'Request completed successfully.',
      severity: 'SUCCESS',
    }
  );
}

function buildTemplateHandler<TResult>(
  options: TemplateApiHandlerOptions,
  handler: ApiHandler<ReturnType<typeof buildRequestContext>, TResult | typeof HTTP_NO_CONTENT>,
) {
  return async (event: MiddlewarePipelineEvent, lambdaContext: unknown): Promise<TResult> => {
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

    const message = resolveMessage(options, req, result);
    const responseOptions = { correlationId: correlationIdFromContext };

    if (options.useCreated) {
      return ApiResponse.created(result, message, responseOptions) as TResult;
    }

    return ApiResponse.ok(result, message, responseOptions) as TResult;
  };
}

/**
 * Template-service HTTP handler with operation-specific success messages.
 */
export function withTemplateApiHandler<
  TEvent extends MiddlewarePipelineEvent,
  TResult,
  TContext = unknown,
>(
  options: TemplateApiHandlerOptions,
  handler: ApiHandler<ReturnType<typeof buildRequestContext>, TResult | typeof HTTP_NO_CONTENT>,
) {
  const stack = buildApiExecutionPipeline<TResult, TContext>({
    operation: options.operation,
    schema: options.schema,
  });

  return runMiddlewares(stack, buildTemplateHandler(options, handler));
}

/** @deprecated Use {@link withTemplateApiHandler} — kept as alias for enablement patch handler. */
export const withApiHandlerOrNoContent = withTemplateApiHandler;
