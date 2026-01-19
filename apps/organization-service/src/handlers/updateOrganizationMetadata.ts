import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';
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
    return ApiResponse.badRequest(
      { title: 'Invalid request', description: 'organizationId is required' },
      { requestId: correlationId },
      { code: 'BAD_REQUEST' },
    );
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
    return ApiResponse.badRequest(
      { title: 'Invalid request', description: 'Invalid JSON body' },
      { requestId: correlationId },
      { code: 'BAD_REQUEST' },
    );
  }

  const validationResult = updateOrganizationMetadataSchema.safeParse(body);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      { title: 'Validation error', description: 'Invalid request body' },
      { requestId: correlationId },
      {
        code: 'VALIDATION_ERROR',
        details: validationResult.error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    );
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
    return ApiResponse.ok(
      metadata,
      { title: 'Success', description: 'Organization metadata updated' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 404, duration, correlationId);
      return ApiResponse.notFound(
        { title: 'Organization not found', description: err.message },
        { requestId: correlationId },
        { code: 'ORGANIZATION_NOT_FOUND' },
      );
    }
    logger.error({ event: 'updateOrganizationMetadata_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/organization/${organizationId}/metadata`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to update organization metadata', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'UPDATE_METADATA_FAILED' },
    );
  }
};
