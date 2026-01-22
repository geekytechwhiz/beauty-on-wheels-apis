import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceMappingService } from '../services/deviceMappingService';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceMappingService = new DeviceMappingService();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceOrgRemove_received' });

  // Extract path parameters
  const deviceId = event.pathParameters?.deviceId;
  const orgId = event.pathParameters?.orgId;

  // Validate path parameters
  if (!deviceId || !orgId) {
    logger.warn({ event: 'deviceOrgRemove_validation_error', deviceId, orgId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}/organizations/{orgId}', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      { requestId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'deviceId and orgId are required in path parameters' }],
      },
    );
  }

  try {
    await deviceMappingService.removeDeviceFromOrganization(deviceId, orgId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}/organizations/{orgId}', 200, duration, correlationId);
    return ApiResponse.ok(null, 'DEVICE.DEVICE_ORG_REMOVED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceOrgRemove_error', err: serializeError(err) });

    const errorMessage = (err as Error).message;
    if (errorMessage.includes('not found')) {
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}/organizations/{orgId}', 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_ORG_MAPPING_NOT_FOUND', { requestId: correlationId, event }, { code: 'MAPPING_NOT_FOUND' });
    }

    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}/organizations/{orgId}', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.REMOVAL_FAILED', { requestId: correlationId, event }, { code: 'REMOVAL_FAILED' });
  }
};
