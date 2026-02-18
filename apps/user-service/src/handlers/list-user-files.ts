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

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export async function listUserFiles(
  event: APIGatewayProxyEvent,
  context?: Context,
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;

  if (!userId) {
    const logger = createChildLogger(baseLogger, {
      correlationId,
      ...(awsRequestId && { awsRequestId }),
    });
    const duration = Date.now() - startTime;
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/users/${userId}/files`,
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
  logger.info({ event: 'listUserFiles_received', eventData: event });

  try {
    const result = await userService.listUserFiles(userId);
    const duration = Date.now() - startTime;
    logger.info({ event: 'listUserFiles_success', count: result.length });
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/users/${userId}/files`,
      200,
      duration,
      correlationId,
    );
    return ApiResponse.ok(
      result,
      'USER.LIST_FILES_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(
        logger,
        event.httpMethod || 'GET',
        event.path || `/users/${userId}/files`,
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
      event: 'listUserFiles_error',
      err: serializeError(err as Error),
    });
    logHttpRequest(
      logger,
      event.httpMethod || 'GET',
      event.path || `/users/${userId}/files`,
      500,
      duration,
      correlationId,
    );
    return ApiResponse.internalServerError(
      'USER.LIST_FILES_FAILED',
      { requestId: correlationId, event },
      {
        code: 'LIST_USER_FILES_FAILED',
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
  return listUserFiles(event, context);
};

