import {
  APIGatewayProxyevent: any,
  APIGatewayProxyResult,
  Context
} from 'aws-lambda';

import {
  createLogger,
  createChildLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError
} from '@api-hub/observability';

import { ApiResponse } from '@api-hub/utils'; 
import { SSOController } from '../../controllers/sso.controller'; 

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true
});

const controller = new SSOController();

export async function handler(
  event: APIGatewayProxyevent: any,
  context: Context
): Promise<APIGatewayProxyResult> {

  const correlationId = extractCorrelationId(event);
  const awsRequestId = extractAwsRequestId(context);

  const logger = createChildLogger(baseLogger, {
    correlationId,
    awsRequestId,
    component: 'LaunchHandler'
  });

  logger.info({
    event: 'lambda_invocation_start',
    httpMethod: event.httpMethod,
    path: event.path
  });

  try { 

    const response = await controller.handleLaunch(event);

    logger.info({
      event: 'lambda_invocation_complete',
      statusCode: response.statusCode
    });

    return response;

  } catch (error) {

    logger.error({
      event: 'lambda_unhandled_error',
      err: serializeError(error as Error)
    });

    return ApiResponse.internalServerError(
      { title: 'Error', description: 'An unexpected error occurred', severity: 'ERROR' },
      {
         correlationId: correlationId,
        event
      },
      {
        code: 'INTERNAL_ERROR'
      }
    );
  }
}