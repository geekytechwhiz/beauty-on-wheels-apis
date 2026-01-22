import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceMappingService } from '../services/deviceMappingService';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceMappingService = new DeviceMappingService();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceOrgAssign_received' });

  // Extract path parameters
  const deviceId = event.pathParameters?.deviceId;
  const orgId = event.pathParameters?.orgId;

  // Validate path parameters
  if (!deviceId || !orgId) {
    logger.warn({ event: 'deviceOrgAssign_validation_error', deviceId, orgId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/organizations/{orgId}', 400, duration, correlationId);
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
    const mapping = await deviceMappingService.assignDeviceToOrganization(deviceId, orgId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/organizations/{orgId}', 201, duration, correlationId);
    return ApiResponse.created(mapping, 'DEVICE.DEVICE_ORG_ASSIGNED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceOrgAssign_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/organizations/{orgId}', 500, duration, correlationId);

    if (err instanceof DeviceNotFoundError) {
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', { requestId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }

    return ApiResponse.internalServerError('DEVICE.ASSIGNMENT_FAILED', { requestId: correlationId, event }, { code: 'ASSIGNMENT_FAILED' });
  }
};
