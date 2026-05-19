import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceMappingService } from '../services/deviceMappingService';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceMappingService = new DeviceMappingService();

const deviceOrgListImpl: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceOrgList_received' });

  // Extract path parameters
  const deviceId = event.pathParameters?.deviceId;

  // Validate path parameters
  if (!deviceId) {
    logger.warn({ event: 'deviceOrgList_validation_error', deviceId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/{deviceId}/organizations', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'deviceId is required in path parameters' }],
      },
    );
  }

  try {
    const organizations = await deviceMappingService.listDeviceOrganizations(deviceId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/{deviceId}/organizations', 200, duration, correlationId);
    return ApiResponse.ok(organizations, 'DEVICE.DEVICE_ORGANIZATIONS_LISTED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceOrgList_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/{deviceId}/organizations', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.LIST_RETRIEVAL_FAILED', { requestId: correlationId, event }, { code: 'LIST_RETRIEVAL_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.orgList', deviceOrgListImpl, { serviceName: 'device-service' });
