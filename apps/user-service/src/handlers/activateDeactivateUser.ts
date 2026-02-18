import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { activateDeactivateUserSchema } from '../validation/user.validation';
import { UserNotFoundError } from '../utils/errors';
import { getAuthorizerUserId, getAuthorizerOrganizationId } from '../utils/helpers';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

const PATH = '/user/activate-deactivate';

export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'activateDeactivateUser_received' });

  const requestUserId = getAuthorizerUserId(event);
  const requestOrgId = getAuthorizerOrganizationId(event);

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'activateDeactivateUser_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const rawBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const payload = {
    action: rawBody.action,
    organizationID: rawBody.organizationID ?? requestOrgId,
    patientUserId: rawBody.patientUserId,
  };

  const validationResult = activateDeactivateUserSchema.safeParse(payload);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'VALIDATION.FIELD_REQUIRED',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validationResult.error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    );
  }

  const { action, organizationID, patientUserId } = validationResult.data;
  const organizationId = organizationID ?? requestOrgId;
  const targetUserId = patientUserId ?? requestUserId;

  if (!organizationId || !targetUserId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'VALIDATION.ORGANIZATION_ID_REQUIRED',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const actionNormalized = action.toUpperCase() as 'ACTIVATE' | 'DEACTIVATE';

  try {
    await userService.activateDeactivateUser(
      organizationId,
      targetUserId,
      actionNormalized,
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 200, duration, correlationId);
    return ApiResponse.ok(
      { message: actionNormalized === 'ACTIVATE' ? 'User activated' : 'User deactivated' },
      'USER.ACTIVATE_DEACTIVATE_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND' },
      );
    }
    logger.error({ event: 'activateDeactivateUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
}
