import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { UserService } from '../services/user.service';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { getOrganizationUserCountSchema } from '../validation/user.validation';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userService = new UserService();

const PATH = '/user/organization-user-count';

export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'getOrganizationUserCount_received' });

  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> } | undefined)?.authorizer;
  const requestOrgId = (authorizer?.organizationID as string) ?? (authorizer?.organizationId as string);

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'getOrganizationUserCount_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const rawBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const payload = {
    organizationId: rawBody.organizationId ?? requestOrgId,
    roleId: rawBody.roleId,
    roleName: rawBody.roleName,
    roleType: rawBody.roleType,
    status: rawBody.status,
  };

  const validationResult = getOrganizationUserCountSchema.safeParse(payload);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validationResult.error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    );
  }

  const { organizationId, roleId, roleName, roleType, status } = validationResult.data;

  if (!organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'VALIDATION.ORGANIZATION_ID_REQUIRED',
      { requestId: correlationId, event },
      { code: 'ORGANIZATION_ID_REQUIRED' },
    );
  }

  const filters: { roleId?: string; roleName?: string; roleType?: string; status?: string } = {};
  if (roleId) filters.roleId = roleId;
  if (roleName) filters.roleName = String(roleName).toUpperCase().replace(/\s/g, '_');
  if (roleType) filters.roleType = String(roleType).toUpperCase();
  if (status) filters.status = String(status).toUpperCase();

  try {
    const data = await userService.getOrganizationUserCounts(
      organizationId,
      Object.keys(filters).length ? filters : undefined,
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 200, duration, correlationId);
    return ApiResponse.ok(data, 'ROLE.ORGANIZATION_USER_COUNT_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'getOrganizationUserCount_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
}
