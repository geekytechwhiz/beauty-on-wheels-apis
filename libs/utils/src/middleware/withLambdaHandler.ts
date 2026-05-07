import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { buildRequestContext } from './request-context.middleware';

import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  createChildLogger,
  logHttpRequest,
} from '@api-hub/logger';

import { successResponse } from './response.middleware';
import { handleError } from './error.middleware';
import { Message } from '../types/core-types';
import { ApiResponse } from '../helper/http-response.helpers';

const baseLogger = createLogger({
  service: 'api-service',
  redactPII: true,
});

export interface LambdaHandlerOptions {
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

export const withLambdaHandler =
  <TRequest = any, TResult = any>(
    handler: (request: TRequest) => Promise<TResult>,
    options: LambdaHandlerOptions = {}
  ) =>
  async (event: APIGatewayProxyEvent, context: Context) => {
    /** Immediate response for serverless-plugin-warmup (non-HTTP payload) */
    if (
      event &&
      typeof event === 'object' &&
      (event as { source?: string }).source === 'serverless-plugin-warmup'
    ) {
      // console.log('WarmUP - Lambda is warm!');
      return {
        statusCode: 200,
        body: JSON.stringify('Lambda is warm!'),
      };
    }

    const startTime = Date.now();

    const correlationId = extractCorrelationId(event) || context.awsRequestId;
    const awsRequestId = extractAwsRequestId(context);

    const logger = createChildLogger(baseLogger, {
      correlationId,
      awsRequestId,
    });

    const method = event.httpMethod ?? 'GET';
    const path = event.path ?? 'unknown';

    let request: any;

    try {

      /**
       * Build request context
       */
      request = buildRequestContext(event);

      request.context = {
        ...(request.context ?? {}),
        logger,
        correlationId,
        awsRequestId,
      };

      /**
       * Validation middleware
       */
      if (options.validator) {
        await options.validator(request);
      }

      /**
       * Business logic handler
       */
      const result = await handler(request);

      const duration = Date.now() - startTime;

      const successStatus = options.useCreated ? 201 : 200;

      logHttpRequest(
        logger,
        method,
        path,
        successStatus,
        duration,
        correlationId
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

      /**
       * Response middleware
       */
      return successResponse(
        result,
        successMessage,
        { correlationId }
      );

    } catch (error: any) {

      const duration = Date.now() - startTime;

      logHttpRequest(
        logger,
        method,
        path,
        error?.statusCode ?? 500,
        duration,
        correlationId
      );

      /**
       * Error middleware
       */
      return handleError(error, {
        correlationId,
        logger,
        event,
      });
    }
  };