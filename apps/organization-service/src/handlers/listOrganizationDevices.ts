import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ApiResponse } from '@api-hub/utils';

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
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}/devices`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      { title: 'Invalid request', description: 'organizationId is required' },
      { requestId: correlationId },
      { code: 'BAD_REQUEST' },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'listOrganizationDevices_received' });

  try {
    const devices = await organizationService.listOrganizationDevices(organizationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}/devices`, 200, duration, correlationId);
    return ApiResponse.ok(
      devices,
      { title: 'Success', description: 'Organization devices retrieved successfully' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}/devices`, 404, duration, correlationId);
      return ApiResponse.notFound(
        { title: 'Organization not found', description: err.message },
        { requestId: correlationId },
        { code: 'ORGANIZATION_NOT_FOUND' },
      );
    }
    logger.error({ event: 'listOrganizationDevices_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/organization/${organizationId}/devices`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to list organization devices', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'LIST_DEVICES_FAILED' },
    );
  }
};
