import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  createLogger,
  extractAwsRequestId,
  extractCorrelationId,
  serializeError,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getAppointmentSyncController } from '../../controllers/appointment-sync.controller';

const logger = createLogger({ service: 'sso-integration', redactPII: true });

export async function handler(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  logger.info({
    event: 'lambda_invocation_start',
    handler: 'appointments/sync',
    correlationId,
    awsRequestId,
    httpMethod: event.httpMethod,
    path: event.path,
    token: event.headers?.Authorization,
    tokenType: event.headers?.['Authorization']?.split(' ')[0],
    tokenValue: event.headers?.['Authorization']?.split(' ')[1],
    tokenExpiresAt: event.headers?.['Authorization']?.split(' ')[2],
    tokenIssuedAt: event.headers?.['Authorization']?.split(' ')[3],
    tokenIssuer: event.headers?.['Authorization']?.split(' ')[4],
    tokenAudience: event.headers?.['Authorization']?.split(' ')[5],
    tokenSubject: event.headers?.['Authorization']?.split(' ')[6],
  });

  try {
    const controller = getAppointmentSyncController();
    const result = await controller.handleSyncAppointments(event);

    logger.info({
      event: 'lambda_invocation_complete',
      handler: 'appointments/sync',
      correlationId,
      statusCode: result.statusCode,
    });

    return result;
  } catch (error) {
    logger.error({
      event: 'lambda_invocation_error',
      handler: 'appointments/sync',
      correlationId,
      err: serializeError(error as Error),
    });

    return ApiResponse.internalServerError(
      { title: 'Error', description: 'An unexpected error occurred', severity: 'ERROR' },
      { requestId: correlationId, },
      { code: 'INTERNAL_ERROR' },
    );
  }
}

