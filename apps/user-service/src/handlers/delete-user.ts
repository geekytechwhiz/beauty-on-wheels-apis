import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
  APIGatewayProxyHandler,
} from 'aws-lambda';
import {
  createLogger,
  createChildLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { UserService } from '../services/user.service';
import { UserNotFoundError } from '../utils/errors';
import { getAuthorizerOrganizationId } from '../utils/helpers';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export async function deleteUser(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;
  const organizationId =
    event.pathParameters?.organizationId ||
    (event as any).organizationId ||
    (event as any).organizationID ||
    getAuthorizerOrganizationId(event);

  if (!userId) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'DELETE',
      event.path || `/users/${userId}`,
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'userId is required' }],
      },
    );
  }

  const logger = createChildLogger(baseLogger, {
    correlationId,
    userId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'deleteUser_received', eventData: event });

  try {
    if (!organizationId) {
      const duration = Date.now() - startTime;
      logHttpRequest(
        logger,
        event.httpMethod || 'DELETE',
        event.path || `/users/${userId}`,
        400,
        duration,
        correlationId,
      );
      return ApiResponse.badRequest(
        'COMMON.BAD_REQUEST',
        { requestId: correlationId, event },
        {
          code: 'BAD_REQUEST',
          details: [{ message: 'organizationId is required' }],
        },
      );
    }
    await userService.deleteUser(userId, organizationId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'DELETE',
      event.path || `/users/${userId}`,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(
      null,
      'USER.USER_DELETED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'DELETE',
        event.path || `/users/${userId}`,
        404,
        duration,
        correlationId,
      );
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        {
          code: 'USER_NOT_FOUND',
          details: [{ message: err.message }],
        },
      );
    }
    logger.error({
      event: 'deleteUser_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'DELETE',
      event.path || `/users/${userId}`,
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.DELETE_USER_FAILED',
      { requestId: correlationId, event },
      {
        code: 'DELETE_USER_FAILED',
        details: [
          { message: (err as Error)?.message || 'Unknown error' },
        ],
      },
    );
  }
}

export const main: APIGatewayProxyHandler = async (
  event,
  context: Context,
) => {
  return deleteUser(event, context);
};

