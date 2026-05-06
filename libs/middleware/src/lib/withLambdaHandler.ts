import type { z } from 'zod';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

import { buildRequestContext } from './request-context.middleware';
import { createStandardLambdaHttpMiddlewares } from './standard-lambda-middleware';
import { runMiddlewares } from './middlewareEngine';
import type { Handler, Middleware, RequestBuildEvent } from './types';

import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  createChildLogger,
  logHttpRequest,
} from '@api-hub/logger';

import { successResponse } from './response.middleware';
import { ApiResponse, handleError, type Message } from '@api-hub/utils';

const baseLogger = createLogger({
  service: 'api-service',
  redactPII: true,
});

export interface LambdaHandlerOptions {
  /**
   * X-Ray / Powertools `serviceName` and tracer singleton key (e.g. `user-service`).
   * Defaults to `api-service` when omitted.
   */
  serviceName?: string;
  /**
   * Name used by the standard `performance` middleware (metrics / logs), e.g. `user.get`.
   * Defaults to `apigateway` when omitted.
   */
  operation?: string;
  /**
   * Optional Zod schema for the raw API Gateway / Lambda `event` (use {@link   withApiHandler} for new code).
   */
  schema?: z.ZodType<unknown>;
  validator?: (request: any) => void | Promise<void>;
  /**
   * CDN message key (e.g. MODULE.MESSAGE_CODE) for success responses.
   * When set, uses ApiResponse.ok/created with `{ requestId, event }` for i18n.
   * When omitted, uses {@link successResponse} with a generic Message.
   */
  successMessageKey?: string;
  /** When true, success uses HTTP 201 with {@link ApiResponse.created}. */
  useCreated?: boolean;
}

function buildWithLambdaHandlerInner<TRequest, TResult>(
  handler: (request: TRequest) => Promise<TResult>,
  options: LambdaHandlerOptions,
): Handler<APIGatewayProxyEvent, APIGatewayProxyResult, Context> {
  return async (event, context) => {
    const startTime = Date.now();

    const correlationId = extractCorrelationId(event) || context.awsRequestId;
    const awsRequestId = extractAwsRequestId(context);

    const logger = createChildLogger(baseLogger, {
      correlationId,
      awsRequestId,
    });

    const method = event.httpMethod ?? 'GET';
    const path = event.path ?? 'unknown';

    let request: TRequest = undefined as TRequest;

    try {
      request = buildRequestContext(event as unknown as RequestBuildEvent) as TRequest;

      (request as { context?: Record<string, unknown> }).context = {
        ...((request as { context?: Record<string, unknown> }).context ?? {}),
        logger,
        correlationId,
        awsRequestId,
      };

      if (options.validator) {
        await options.validator(request);
      }

      const result = await handler(request);

      const duration = Date.now() - startTime;

      const successStatus = options.useCreated ? 201 : 200;

      logHttpRequest(
        logger,
        method,
        path,
        successStatus,
        duration,
        correlationId,
      );

      const responseOptions = { requestId: correlationId, event };

      if (options.successMessageKey) {
        const messageKey = options.successMessageKey as unknown as Message;
        if (options.useCreated) {
          return ApiResponse.created(result, messageKey, responseOptions);
        }
        return ApiResponse.ok(result, messageKey, responseOptions);
      }

      const successMessage: Message = {
        title: 'SUCCESS',
        description: 'Request processed successfully',
        severity: 'SUCCESS',
      };

      return successResponse(result, successMessage, { correlationId });
    } catch (error: unknown) {
      const err = error as { statusCode?: number };
      const duration = Date.now() - startTime;

      logHttpRequest(
        logger,
        method,
        path,
        err?.statusCode ?? 500,
        duration,
        correlationId,
      );

      return handleError(error as Parameters<typeof handleError>[0], {
        correlationId,
        logger,
        event,
      });
    }
  };
}

/**
 * API Gateway (Lambda) handler with the standard cross-service middleware order:
 * `error` → `context` → `logger` → `tracer` → `schema` → `performance`, then request build + your handler.
 */
export const withLambdaHandler =
  <TRequest = any, TResult = any>(
    handler: (request: TRequest) => Promise<TResult>,
    options: LambdaHandlerOptions = {},
  ) =>
  async (event: APIGatewayProxyEvent, context: Context) => {
    if (
      event &&
      typeof event === 'object' &&
      (event as { source?: string }).source === 'serverless-plugin-warmup'
    ) {
      
      return {
        statusCode: 200,
        body: JSON.stringify('Lambda is warm!'),
      };
    }

    const inner = buildWithLambdaHandlerInner(handler, options);
    const operation = options.operation ?? 'apigateway';
    const stack = createStandardLambdaHttpMiddlewares<APIGatewayProxyResult, Context>({
      serviceName: options.serviceName,
      operation,
      schema: options.schema,
    });
    return runMiddlewares<APIGatewayProxyEvent, APIGatewayProxyResult, Context>(
      stack as unknown as Array<Middleware<APIGatewayProxyEvent, APIGatewayProxyResult, Context>>,
      inner,
    )(event, context);
  };
