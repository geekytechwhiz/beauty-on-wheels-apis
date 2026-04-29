import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getAlertHttpController } from '../../controllers/alert-http.controller';
import { getLambdaInvocationMeta } from '../../utils/helpers';

const logger = createLogger({ service: 'alert-service', redactPII: true });

const HANDLER = 'alerts/create';

/**
 * POST /alerts — same shell as sso `appointment-sync` handler: start log → controller
 * (builds `LambdaRequest`, validation, `ApiResponse`) → complete log, or 500 on unexpected throw.
 */
export async function main(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const { correlationId, awsRequestId } = getLambdaInvocationMeta(event, context);

  logger.info({
    event: 'lambda_invocation_start',
    handler: HANDLER,
    correlationId,
    awsRequestId,
    httpMethod: event.httpMethod,
    path: event.path,
  });

  try {
    const result = await getAlertHttpController().handleCreateAlert(event, context);

    logger.info({
      event: 'lambda_invocation_complete',
      handler: HANDLER,
      correlationId,
      statusCode: result.statusCode,
    });

    return result;
  } catch (error) {
    logger.error({
      event: 'lambda_invocation_error',
      handler: HANDLER,
      correlationId,
      err: serializeError(error as Error),
    });

    return ApiResponse.internalServerError(
      { title: 'Error', description: 'An unexpected error occurred', severity: 'ERROR' },
      { requestId: correlationId, event },
      { code: 'INTERNAL_ERROR' },
    );
  }
}
