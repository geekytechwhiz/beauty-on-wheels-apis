import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';
import { updateOrganizationSchema } from '../validation/organization.validation';
import { normalizeOrganizationPayload } from '../utils/organizationPayload';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const organizationId = event.pathParameters?.organizationId;

  if (!organizationId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'updateOrganization_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'updateOrganization_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const normalized = normalizeOrganizationPayload(body);
  const hasAdminDetails =
    body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body as Record<string, unknown>, 'adminDetails');
  const adminDetails = normalized.data.adminDetails;
  if (!hasAdminDetails) {
    normalized.data.adminDetails = undefined;
  } else if (adminDetails === undefined || adminDetails === null) {
    normalized.data.adminDetails = [];
  } else if (!Array.isArray(adminDetails) && typeof adminDetails === 'object') {
    normalized.data.adminDetails = [adminDetails];
  }
  if (normalized.data.organizationInfo && typeof normalized.data.organizationInfo === 'object') {
    normalized.data.organizationInfo = {
      ...(normalized.data.organizationInfo as Record<string, unknown>),
      organizationID: organizationId,
    };
  }
  if (normalized.errors.length > 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: normalized.errors.map((e) => ({
          field: (e as any).field,
          message: (e as any).message ?? 'Invalid request body',
        })),
      },
    );
  }

  const validationResult = updateOrganizationSchema.safeParse(normalized.data);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
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

  try {
    const organization = await organizationService.updateOrganization(organizationId, validationResult.data, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 200, duration, correlationId);
    return ApiResponse.ok(
      organization,
      'ORGANIZATION.ORGANIZATION_UPDATED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 404, duration, correlationId);
      return ApiResponse.notFound(
        'ORGANIZATION.ORGANIZATION_NOT_FOUND',
        { requestId: correlationId, event },
        { code: 'ORGANIZATION_NOT_FOUND' },
      );
    }
    logger.error({ event: 'updateOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'ORGANIZATION.UPDATE_ORGANIZATION_FAILED',
      { requestId: correlationId, event },
      { code: 'UPDATE_ORGANIZATION_FAILED' },
    );
  }
};
