import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'; 
import { extractCorrelationId, extractAwsRequestId, createChildLogger, serializeError, logHttpRequest, createLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { UserNotFoundError } from '../utils/errors';
import { assignDoctorSchema } from '../validation/user.validation';
import { PATH_ASSIGN_DOCTOR } from '../utils/constants';
import { UserService } from '../services/user.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();
 
export async function handler(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'assignDoctor_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'assignDoctor_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
  }
  
  const validation = assignDoctorSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'assignDoctor_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e) => ({
          field: e.path.map(String).join('.'),
          message: e.message,
        })),
      },
    );
  }

  const { organizationId, sender, receiver } = validation.data;
  try {
    await userService.assignDoctor(organizationId, sender, receiver, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 200, duration, correlationId);
    return ApiResponse.ok(
      { message: 'Patient assigned to doctor successfully!' },
      'USER.ASSIGN_DOCTOR_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: (err as Error).message }] },
      );
    }
    if ((err as Error)?.message === 'DOCTOR_NOT_LINKED_WITH_USER') {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 502, duration, correlationId);
      return ApiResponse.badRequest(
        'USER.DOCTOR_NOT_LINKED',
        { requestId: correlationId, event },
        { code: 'DOCTOR_NOT_LINKED_WITH_USER' },
      );
    }
    logger.error({ event: 'assignDoctor_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_ASSIGN_DOCTOR, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.ASSIGN_DOCTOR_FAILED',
      { requestId: correlationId, event },
      { code: 'ASSIGN_DOCTOR_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}