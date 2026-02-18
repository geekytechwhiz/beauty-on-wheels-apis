import { createChildLogger, createLogger, extractAwsRequestId, extractCorrelationId, logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { FriendFamilyService } from '../services/friendFamily.service';
import { PATH_FNF_CHECK } from '../utils/constants';
const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const friendFamilyService = new FriendFamilyService(); 
export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const query = event.queryStringParameters || {};
  const inviterId = (query.inviterId ?? '').trim();
  const inviteeId = (query.inviteeId ?? '').trim();
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  if (!inviterId || !inviteeId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', PATH_FNF_CHECK, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST', details: [{ message: 'inviterId and inviteeId query parameters are required' }] },
    );
  }

  try {
    const mapping = await friendFamilyService.checkInvite(inviterId, inviteeId);
    const duration = Date.now() - startTime;
    if (!mapping) {
      logHttpRequest(logger, event.httpMethod || 'GET', PATH_FNF_CHECK, 404, duration, correlationId);
      return ApiResponse.notFound(
        'FRIEND_FAMILY.INVITE_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'INVITE_NOT_FOUND', details: [{ message: 'No friend-family invite found for this inviter and invitee' }] },
      );
    }
    logHttpRequest(logger, event.httpMethod || 'GET', PATH_FNF_CHECK, 200, duration, correlationId);
    return ApiResponse.ok(mapping, 'FRIEND_FAMILY.CHECK_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'friendFamilyCheck_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', PATH_FNF_CHECK, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'FRIEND_FAMILY.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR', details: [{ message: (err as Error)?.message || 'Unknown error' }] },
    );
  }
}
