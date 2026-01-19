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
  const deviceId = event.pathParameters?.deviceId;

  if (!organizationId || !deviceId) {
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || `/organization/${organizationId}/device/${deviceId}`, 400, duration, correlationId);
    return ApiResponse.badRequest(
      { title: 'Invalid request', description: 'organizationId and deviceId are required' },
      { requestId: correlationId },
      { code: 'BAD_REQUEST' },
    );
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, deviceId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'assignDeviceToOrganization_received' });

  try {
    await organizationService.assignDeviceToOrganization(organizationId, deviceId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || `/organization/${organizationId}/device/${deviceId}`, 200, duration, correlationId);
    return ApiResponse.ok(
      null,
      { title: 'Success', description: 'Device assigned to organization' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || `/organization/${organizationId}/device/${deviceId}`, 404, duration, correlationId);
      return ApiResponse.notFound(
        { title: 'Organization not found', description: err.message },
        { requestId: correlationId },
        { code: 'ORGANIZATION_NOT_FOUND' },
      );
    }
    logger.error({ event: 'assignDeviceToOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || `/organization/${organizationId}/device/${deviceId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      { title: 'Failed to assign device to organization', description: (err as Error)?.message || 'Unknown error' },
      { requestId: correlationId },
      { code: 'ASSIGN_DEVICE_FAILED' },
    );
  }
};
