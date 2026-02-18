import { createChildLogger, createLogger, extractAwsRequestId, extractCorrelationId, logHttpRequest, serializeError } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { FriendFamilyService } from '../services/friendFamily.service';
import { PATH_FNF_ADD } from '../utils/constants';
import { UserNotFoundError } from '../utils/errors';
import { getAuthorizerOrganizationId, getAuthorizerUserId } from '../utils/helpers';
import { addMemberFriendFamilySchema } from '../validation/friendFamily.validation';
const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const friendFamilyService = new FriendFamilyService(); 
export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  const authHeader = event.headers?.Authorization ?? event.headers?.authorization;

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const b = body as Record<string, unknown>;
  const userIdFromAuth = getAuthorizerUserId(event);
  const userId = (b.userId as string) ?? (b.userID as string) ?? userIdFromAuth;
  const organizationID = (b.organizationID as string) ?? getAuthorizerOrganizationId(event);
  const payload = { ...b, userId, organizationID } as Record<string, unknown>;
  const validation = addMemberFriendFamilySchema.safeParse(payload);
  if (!validation.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity('COMMON.VALIDATION_ERROR', { requestId: correlationId, event }, {
      code: 'VALIDATION_ERROR',
      details: validation.error.issues.map((e) => ({ field: e.path.map(String).join('.'), message: e.message })),
    });
  }
  if (!userId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }
  const orgId = validation.data.organizationID ?? organizationID;
  if (!orgId || !orgId.trim()) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: 'UNAUTHORIZED' });
  }

  try {
    const { organizationID: _omit, ...addBody } = validation.data;
    const data = await friendFamilyService.addMember(orgId, { ...addBody, userId }, authHeader);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 200, duration, correlationId);
    return ApiResponse.ok(data, 'FRIEND_FAMILY.ADD_MEMBER_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof UserNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 404, duration, correlationId);
      return ApiResponse.notFound('USER.USER_NOT_FOUND', { requestId: correlationId, event }, { code: 'USER_NOT_FOUND', details: [{ message: (err as Error).message }] });
    }
    const msg = (err as Error)?.message;
    if (['ORGANIZATION_NOT_EXIST', 'ORGANIZATION_IS_ON_HOLD', 'ORGANIZATION_MISMATCH'].includes(msg ?? '')) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 400, duration, correlationId);
      return ApiResponse.badRequest(`FRIEND_FAMILY.${msg}`, { requestId: correlationId, event }, { code: msg! });
    }
    logger.error({ event: 'friendFamilyAddMember_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH_FNF_ADD, 500, duration, correlationId);
    return ApiResponse.internalServerError('FRIEND_FAMILY.INTERNAL_SERVER_ERROR', { requestId: correlationId, event }, { code: 'INTERNAL_SERVER_ERROR' });
  }
}
