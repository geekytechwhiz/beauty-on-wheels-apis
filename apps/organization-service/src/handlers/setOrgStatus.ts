import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { OrganizationNotFoundError, PermissionDeniedError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';
import { setOrgStatusSchema } from '../validation/organization.validation';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

const PATH = '/organization/status';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'setOrgStatus_received' });

  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> } | undefined)
    ?.authorizer;
  const userId = (authorizer?.userId as string) ?? (authorizer?.userID as string);
  const userType = authorizer?.userType as string | undefined;

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'setOrgStatus_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const validationResult = setOrgStatusSchema.safeParse(body);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'VALIDATION.FIELD_REQUIRED',
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

  const { organizationId, status } = validationResult.data;

  const authHeader =
    event.headers?.Authorization ||
    event.headers?.authorization ||
    event.headers?.AUTHORIZATION;

  try {
    const result = await organizationService.setOrganizationStatus(
      organizationId,
      status,
      userId,
      userType,
      correlationId,
      typeof authHeader === 'string' ? authHeader : undefined,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 201, duration, correlationId);
    return ApiResponse.created(
      { message: result.message },
      'FACILITY.ORG_STATUS_UPDATED',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof PermissionDeniedError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH, 403, duration, correlationId);
      return ApiResponse.forbidden(
        'COMMON.ACCESS_DENIED',
        { requestId: correlationId, event },
        { code: 'USER_ACCESS_ISSUE' },
      );
    }
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH, 404, duration, correlationId);
      return ApiResponse.notFound(
        'FACILITY.ORGANIZATION_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'ORGANIZATION_NOT_EXIST' },
      );
    }
    logger.error({ event: 'setOrgStatus_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
};
