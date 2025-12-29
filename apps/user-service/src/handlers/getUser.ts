import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { UserNotFoundError } from '../utils/errors';
import { ok, problem } from '../utils/response';

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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'userId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getUser_received' });

  try {
    const user = await userService.getUser(userId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ok(user, { requestId: correlationId });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 404, duration, correlationId);
      return problem({
        title: 'User not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'USER_NOT_FOUND',
      });
    }
    logger.error({ event: 'getUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 500, duration, correlationId);
    return problem({
      title: 'Failed to get user',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'GET_USER_FAILED',
    });
  }
};
