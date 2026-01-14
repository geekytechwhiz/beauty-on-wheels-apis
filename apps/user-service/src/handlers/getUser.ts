import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { UserNotFoundError } from '../utils/errors';
import {
  ok,
  badRequest,
  notFound,
  internalServerError,
} from '@api-hub/utils';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const userId = event.pathParameters?.userId;

  if (!userId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 400, duration, correlationId);
    return badRequest(
      {
        title: 'Invalid request',
        description: 'userId is required',
        severity: 'error',
      },
      [{ code: 'BAD_REQUEST', message: 'userId is required' }],
      { correlationId },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getUser_received' });

  try {
    const user = await userService.getUser(userId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ok(user, 'User retrieved successfully', { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 404, duration, correlationId);
      return notFound(
        {
          title: 'User not found',
          description: err.message,
          severity: 'error',
        },
        [{ code: 'USER_NOT_FOUND', message: err.message }],
        { correlationId },
      );
    }
    logger.error({ event: 'getUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 500, duration, correlationId);
    return internalServerError(
      {
        title: 'Failed to get user',
        description: (err as Error)?.message || 'Unknown error',
        severity: 'error',
      },
      [{ code: 'GET_USER_FAILED', message: (err as Error)?.message || 'Unknown error' }],
      { correlationId },
    );
  }
};
