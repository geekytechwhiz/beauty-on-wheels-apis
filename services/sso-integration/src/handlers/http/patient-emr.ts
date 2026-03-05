import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getAppointmentsController } from '../../controllers/appointments.controller';

const logger = createLogger({ service: 'sso-integration', redactPII: true });

export async function handler(
  event: APIGatewayProxyEvent,
  context?: Context
): Promise<APIGatewayProxyResult> {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  logger.info({
    event: 'lambda_invocation_start',
    handler: 'appointments/patient-emr',
    correlationId,
    awsRequestId,
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters,
  });

  try {
    const controller = getAppointmentsController();
    const result = await controller.handleGetPatientEMR(event);

    logger.info({
      event: 'lambda_invocation_complete',
      handler: 'appointments/patient-emr',
      correlationId,
      statusCode: result.statusCode,
    });

    return result;
  } catch (error) {
    logger.error({
      event: 'lambda_invocation_error',
      handler: 'appointments/patient-emr',
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
