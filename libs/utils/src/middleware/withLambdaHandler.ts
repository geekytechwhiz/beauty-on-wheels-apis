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

const baseLogger = createLogger({
  service: 'api-service',
  redactPII: true,
});

interface LambdaHandlerOptions {
  validator?: (request: any) => void | Promise<void>;
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
      console.log('WarmUP - Lambda is warm!');
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

      logHttpRequest(
        logger,
        method,
        path,
        200,
        duration,
        correlationId
      );

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