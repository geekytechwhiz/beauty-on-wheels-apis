import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ok, problem } from '../utils/response';
import { updateOrganizationMetadataSchema } from '../validation/organization.validation';

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
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'organizationId is required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'updateOrganizationMetadata_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'updateOrganizationMetadata_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'Invalid JSON body',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const validationResult = updateOrganizationMetadataSchema.safeParse(body);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 400, duration, correlationId);
    return problem({
      title: 'Validation error',
      status: 400,
      detail: 'Invalid request body',
      correlationId,
      code: 'VALIDATION_ERROR',
      errors: validationResult.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      })),
    });
  }

  try {
    const metadata = await organizationService.updateOrganizationMetadata(
      organizationId,
      validationResult.data.metadata,
      correlationId,
      validationResult.data.updatedBy,
      validationResult.data.version,
    );
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 200, duration, correlationId);
    return ok(metadata, { requestId: correlationId, message: 'Organization metadata updated' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 404, duration, correlationId);
      return problem({
        title: 'Organization not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'ORGANIZATION_NOT_FOUND',
      });
    }
    logger.error({ event: 'updateOrganizationMetadata_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 500, duration, correlationId);
    return problem({
      title: 'Failed to update organization metadata',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'UPDATE_METADATA_FAILED',
    });
  }
};
