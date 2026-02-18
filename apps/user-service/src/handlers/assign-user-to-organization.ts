import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda'; 
import { extractCorrelationId, extractAwsRequestId, createChildLogger, serializeError, logHttpRequest, createLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { UserNotFoundError } from '../utils/errors'; 
import { UserService } from '../services/user.service';
import { assignUserToOrganizationSchema } from '../validation/user.validation';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();
 
export async function handler(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  
  logger.info({ event: 'assignUserToOrg_received', eventData: event });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'assignUserToOrg_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'Invalid JSON body' }] },
    );
  }

  const validation = assignUserToOrganizationSchema.safeParse(body);
  if (!validation.success) {
    logger.warn({ event: 'assignUserToOrg_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    await userService.assignUserToOrganization(validation.data.userId, validation.data.organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 200, duration, correlationId);
    return ApiResponse.ok(null, 'USER.USER_ASSIGNED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'assignUserToOrg_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/users/organizations/assign', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.ASSIGN_USER_FAILED',
      { requestId: correlationId, event },
      { code: 'ASSIGN_USER_ORG_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}