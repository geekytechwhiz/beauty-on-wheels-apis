import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ok, problem } from '../utils/response';
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'organizationId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
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
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'Invalid JSON body',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const normalized = normalizeOrganizationPayload(body);
  if (normalized.data.organizationInfo && typeof normalized.data.organizationInfo === 'object') {
    normalized.data.organizationInfo = {
      ...(normalized.data.organizationInfo as Record<string, unknown>),
      organizationID: organizationId,
    };
  }
  if (normalized.errors.length > 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return problem({
      title: 'Validation error',
      status: 400,
      detail: 'Invalid request body',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: normalized.errors,
    });
  }

  const validationResult = updateOrganizationSchema.safeParse(normalized.data);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 400, duration, correlationId);
    return problem({
      title: 'Validation error',
      status: 400,
      detail: 'Invalid request body',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: validationResult.error.issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      })),
    });
  }

  try {
    const organization = await organizationService.updateOrganization(organizationId, validationResult.data, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 200, duration, correlationId);
    return ok(organization, { requestId: correlationId, message: 'Organization updated' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 404, duration, correlationId);
      return problem({
        title: 'Organization not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'ORGANIZATION_NOT_FOUND',
      });
    }
    logger.error({ event: 'updateOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}`, 500, duration, correlationId);
    return problem({
      title: 'Failed to update organization',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'UPDATE_ORGANIZATION_FAILED',
    });
  }
};
