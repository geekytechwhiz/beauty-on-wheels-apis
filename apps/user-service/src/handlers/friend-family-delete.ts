import { createChildLogger, createLogger, extractAwsRequestId, extractCorrelationId, logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { FriendFamilyService } from '../services/friendFamily.service';
import { PATH_FNF_DELETE } from '../utils/constants';
import { deleteFriendFamilySchema } from '../validation/friendFamily.validation';
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
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const validation = deleteFriendFamilySchema.safeParse(body);
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: correlationId, event }, {
      code: 'VALIDATION_ERROR',
      details: validation.error.issues.map((e) => ({ field: e.path.map(String).join('.'), message: e.message })),
    });
  }

  const { userID, memberID, organizationID } = validation.data;
  try {
    await friendFamilyService.deleteMember(userID, memberID, organizationID);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 201, duration, correlationId);
    return ApiResponse.created({ userID, memberID, organizationID: organizationID ?? null }, 'FRIEND_FAMILY.DELETE_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if ((err as Error)?.message === 'FNF_DOES_NOT_EXIST') {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 400, duration, correlationId);
      return ApiResponse.badRequest('FRIEND_FAMILY.FNF_DOES_NOT_EXIST', { requestId: correlationId, event }, { code: 'FNF_DOES_NOT_EXIST' });
    }
    logger.error({ event: 'friendFamilyDelete_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_DELETE, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}