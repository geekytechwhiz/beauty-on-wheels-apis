import { createChildLogger, extractAwsRequestId, extractCorrelationId, logHttpRequest } from "@api-hub/logger";
import { handleError } from "./error.middleware";
import { buildRequestContext } from "./request-context.middleware";
import { APIGatewayProxyEvent } from "aws-lambda/trigger/api-gateway-proxy";
import { Context } from "aws-lambda/handler";

export const withLambdaHandler =
  <TRequest = any, TResult = any>(
    handler: (request: TRequest) => Promise<TResult>,
    options: LambdaHandlerOptions = {}
  ) =>
  async (event: APIGatewayProxyEvent, context: Context) => {

    const startTime = Date.now();

    const correlationId = extractCorrelationId(event) || context.awsRequestId;
    const awsRequestId = extractAwsRequestId(context);

    const logger = createChildLogger(baseLogger, {
      correlationId,
      awsRequestId,
    });

    const method = event.httpMethod ?? 'GET';
    const path = event.path ?? 'unknown';

    try {

      const request = buildRequestContext(event);

      request.context = {
        ...(request.context ?? {}),
        logger,
        correlationId,
        awsRequestId,
      };

      if (options.validator) {
        await options.validator(request);
      }

      const response = await handler(request);

      const duration = Date.now() - startTime;

      logHttpRequest(
        logger,
        method,
        path,
        response.statusCode ?? 200,
        duration,
        correlationId
      );

      return response;

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

      return handleError(error, {
        correlationId,
        logger,
        event
      });
    }
  };