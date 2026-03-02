import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getSSOController } from '../../controllers/sso.controller';

const logger = createLogger({ service: 'sso-integration', redactPII: true });

export async function handler(
  event: APIGatewayProxyEvent,
  context?: Context
): Promise<APIGatewayProxyResult> {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  logger.info({
    event: 'lambda_invocation_start',
    handler: 'sso/launch',
    correlationId,
    awsRequestId,
    httpMethod: event.httpMethod,
    path: event.path,
    hasQueryParams: !!event.queryStringParameters,
  });

  try {
    const controller = getSSOController();
    const result = await controller.handleLaunch(event);

    logger.info({
      event: 'lambda_invocation_complete',
      handler: 'sso/launch',
      correlationId,
      statusCode: result.statusCode,
    });

    return result;
  } catch (error) {
    logger.error({
      event: 'lambda_invocation_error',
      handler: 'sso/launch',
      correlationId,
      err: serializeError(error as Error),
    });

    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_ERROR' },
    );
  }
}
