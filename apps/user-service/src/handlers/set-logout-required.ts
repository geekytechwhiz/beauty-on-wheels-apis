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
import { PATH_LOGOUT_REQUIRED } from '../utils/constants';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export async function setLogoutRequired(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;
  const organizationId = event.pathParameters?.organizationId;
  const logger = createChildLogger(baseLogger, {
    correlationId,
    userId,
    organizationId,
    ...(awsRequestId && { awsRequestId }),
  });

  if (!userId || !organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      PATH_LOGOUT_REQUIRED,
      400,
      duration,
      correlationId,
    );
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [
          { message: 'userId and organizationId are required in path' },
        ],
      },
    );
  }

  try {
    await userService.updateUser(
      userId,
      organizationId,
      { logoutRequired: true },
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      PATH_LOGOUT_REQUIRED,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(
      { logoutRequired: true },
      'USER.LOGOUT_REQUIRED_SET',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'PUT',
        PATH_LOGOUT_REQUIRED,
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
      event: 'setLogoutRequired_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'PUT',
      PATH_LOGOUT_REQUIRED,
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.SET_LOGOUT_REQUIRED_FAILED',
      { requestId: correlationId, event },
      {
        code: 'SET_LOGOUT_REQUIRED_FAILED',
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
  return setLogoutRequired(event, context);
};

