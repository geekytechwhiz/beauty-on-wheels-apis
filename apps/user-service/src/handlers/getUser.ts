import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { UserNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  // Path structure: user/organization/{organizationId}/{userId}
  const organizationId = event.pathParameters?.organizationId;
  const userId = event.pathParameters?.userId;

  if (!userId || !organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/user/organization/${organizationId}/${userId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'userId and organizationId are required' }] },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, userId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'getUser_received' });
  
  try {
    const user = await userService.getUser(userId, organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 200, duration, correlationId);
    return ApiResponse.ok(
      user,
      'USER.USER_RETRIEVED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'USER.USER_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'USER_NOT_FOUND', details: [{ message: err.message }] },
      );
    }
    logger.error({ event: 'getUser_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/users/${userId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'USER.GET_USER_FAILED',
      { requestId: correlationId, event },
      { code: 'GET_USER_FAILED', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
};
