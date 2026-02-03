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
import {
  OrganizationNotFoundError,
  PermissionDeniedError,
  OrganizationNotActiveError,
} from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';
import { linkUnlinkOrganizationSchema } from '../validation/organization.validation';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

const PATH = '/organization/link-unlink';

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'linkUnlinkOrganization_received' });

  const authorizer = (event.requestContext as { authorizer?: Record<string, unknown> } | undefined)
    ?.authorizer;
  const userId =
    (authorizer?.userId as string) ??
    (authorizer?.userID as string) ??
    (authorizer?.claims as Record<string, unknown>)?.sub ??
    (authorizer?.claims as Record<string, unknown>)?.['custom:userID'];
  const userType = authorizer?.userType as string | undefined;

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'linkUnlinkOrganization_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const validationResult = linkUnlinkOrganizationSchema.safeParse(body);
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

  const { fromOrg, toOrg, action } = validationResult.data;
  const actionNormalized = action.toUpperCase() as 'LINK' | 'UNLINK';

  try {
    await organizationService.linkUnlinkOrganizations(
      fromOrg,
      toOrg,
      actionNormalized,
      userId ?? '',
      userType,
      correlationId,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 201, duration, correlationId);
    
    // Determine title and description based on action
    const title = actionNormalized === 'LINK' ? 'Org link success' : 'Org unlink success';
    const description = actionNormalized === 'LINK' 
      ? 'The org link completed successfully.' 
      : 'The org unlink completed successfully.';
    const message = actionNormalized === 'LINK' 
      ? 'Org linked successfully' 
      : 'Org unlinked successfully';
    
    return ApiResponse.created(
      { message },
      { title, description },
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof PermissionDeniedError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH, 403, duration, correlationId);
      return ApiResponse.forbidden(
        'COMMON.ACCESS_DENIED',
        { requestId: correlationId, event },
        { code: 'PERMISSION_ISSUE' },
      );
    }
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH, 404, duration, correlationId);
      return ApiResponse.notFound(
        'FACILITY.ORGANIZATION_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'ORGANIZATION_DETAILS_NOT_FOUND' },
      );
    }
    if (err instanceof OrganizationNotActiveError) {
      logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
      return ApiResponse.badRequest(
        'FACILITY.ORGANIZATION_NOT_AVAILABLE',
        { requestId: correlationId, event },
        { code: 'ORGANIZATION_MUST_ACTIVE' },
      );
    }
    logger.error({ event: 'linkUnlinkOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
};
