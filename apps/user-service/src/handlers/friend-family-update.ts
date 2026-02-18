import { createChildLogger, createLogger, extractAwsRequestId, extractCorrelationId, logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { FriendFamilyService } from '../services/friendFamily.service';
import { PATH_FNF_UPDATE } from '../utils/constants';
import { getAuthorizerOrganizationId, getAuthorizerUserId } from '../utils/helpers';
import { updateFriendFamilySchema } from '../validation/friendFamily.validation';
const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const friendFamilyService = new FriendFamilyService(); 
export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const b = body as Record<string, unknown>;
  const userId = (b.userId as string) ?? (b.userID as string) ?? getAuthorizerUserId(event);
  const organizationID = (b.organizationID as string) ?? getAuthorizerOrganizationId(event);
  const validation = updateFriendFamilySchema.safeParse({ ...b, organizationID });
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: correlationId, event }, {
      code: 'VALIDATION_ERROR',
      details: validation.error.issues.map((e) => ({ field: e.path.map(String).join('.'), message: e.message })),
    });
  }
  if (!userId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }
  const orgId = validation.data.organizationID ?? organizationID;
  if (!orgId?.trim()) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }

  try {
    await friendFamilyService.updateMember(userId, orgId, validation.data);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 200, duration, correlationId);
    return ApiResponse.ok(null, 'FRIEND_FAMILY.UPDATE_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if ((err as Error)?.message === 'MEMBER_NOT_FOUND') {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 400, duration, correlationId);
      return ApiResponse.badRequest('FRIEND_FAMILY.MEMBER_NOT_FOUND', { requestId: correlationId, event }, { code: 'MEMBER_NOT_FOUND' });
    }
    logger.error({ event: 'friendFamilyUpdate_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_UPDATE, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
