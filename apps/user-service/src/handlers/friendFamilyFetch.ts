import { createChildLogger, createLogger, extractAwsRequestId, extractCorrelationId, logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { FriendFamilyService } from '../services/friendFamily.service';
import { PATH_FNF_FETCH } from '../utils/constants';
import { getAuthorizerUserId } from '../utils/helpers';
import { fetchFriendFamilySchema } from '../validation/friendFamily.validation';
const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const friendFamilyService = new FriendFamilyService(); 
export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body ?? {};
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_FETCH, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const b = (body as Record<string, unknown>) ?? {};
  const userId = (b.userId as string) ?? (b.userID as string) ?? getAuthorizerUserId(event);
  const validation = fetchFriendFamilySchema.safeParse({ userId: userId ?? '' });
  if (!validation.success || !userId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_FETCH, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'userId is required' }] });
  }

  try {
    const data = await friendFamilyService.fetchMembers(userId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_FETCH, 200, duration, correlationId);
    return ApiResponse.ok(data, 'FRIEND_FAMILY.FETCH_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'friendFamilyFetch_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_FETCH, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
