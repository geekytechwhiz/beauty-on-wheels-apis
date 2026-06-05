import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getAppointmentSyncController } from '../../controllers/appointment-sync.controller';

const logger = createLogger({ service: 'sso-integration', redactPII: true });

export async function handler(
  event: APIGatewayProxyEvent,
  context?: Context
): Promise<APIGatewayProxyResult> {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  logger.info({
    event: 'lambda_invocation_start',
    handler: 'appointments/todays',
    correlationId,
    awsRequestId,
    httpMethod: event.httpMethod,
    path: event.path,
  });

  try {
    const controller = getAppointmentSyncController();
    const result = await controller.handleSyncAppointments(event);

    logger.info({
      event: 'lambda_invocation_complete',
      handler: 'appointments/todays',
      correlationId,
      statusCode: result.statusCode,
    });

    return result;
  } catch (error) {
    logger.error({
      event: 'lambda_invocation_error',
      handler: 'appointments/todays',
      correlationId,
      err: serializeError(error as Error),
    });

    return ApiResponse.internalServerError(
      { title: 'Internal Server Error', description: 'An unexpected error occurred', severity: 'ERROR' },
      { requestId: correlationId, event },
      { code: 'INTERNAL_ERROR' },
    );
  }
}
