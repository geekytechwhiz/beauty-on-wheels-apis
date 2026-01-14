import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { OrganizationService } from '../services/organization.service';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { OrganizationNotFoundError } from '../utils/errors';
import { ok, problem } from '../utils/response';

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
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/organization/${organizationId}/device/${deviceId}`, 400, duration, correlationId);
    return problem({
      title: 'Invalid request',
      status: 400,
      detail: 'organizationId and deviceId are required',
      correlationId,
      code: 'BAD_REQUEST',
    });
  }

  const logger = createChildLogger(baseLogger, { correlationId, organizationId, deviceId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'removeDeviceFromOrganization_received' });

  try {
    await organizationService.removeDeviceFromOrganization(organizationId, deviceId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/organization/${organizationId}/device/${deviceId}`, 200, duration, correlationId);
    return ok(null, { requestId: correlationId, message: 'Device removed from organization' });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof OrganizationNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/organization/${organizationId}/device/${deviceId}`, 404, duration, correlationId);
      return problem({
        title: 'Organization not found',
        status: 404,
        detail: err.message,
        correlationId,
        code: 'ORGANIZATION_NOT_FOUND',
      });
    }
    logger.error({ event: 'removeDeviceFromOrganization_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/organization/${organizationId}/device/${deviceId}`, 500, duration, correlationId);
    return problem({
      title: 'Failed to remove device from organization',
      status: 500,
      detail: (err as Error)?.message || 'Unknown error',
      correlationId,
      code: 'REMOVE_DEVICE_FAILED',
    });
  }
};
