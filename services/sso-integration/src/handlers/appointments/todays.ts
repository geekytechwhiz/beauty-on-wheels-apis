import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError } from '@api-hub/logger';
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
    handler: 'appointments/todays',
    correlationId,
    awsRequestId,
    httpMethod: event.httpMethod,
    path: event.path,
  });

  try {
    const controller = getAppointmentsController();
    const result = await controller.handleGetTodaysAppointments(event);

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

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          requestId: correlationId,
        },
      }),
    };
  }
}
