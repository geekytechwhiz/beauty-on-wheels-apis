import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { DeviceMappingService } from '../services/deviceMappingService';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceMappingService = new DeviceMappingService();

const deviceUserAssignImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceUserAssign_received' });

  // Extract path parameters
  const deviceId = event.pathParameters?.deviceId;
  const userId = event.pathParameters?.userId;

  // Validate path parameters
  if (!deviceId || !userId) {
    logger.warn({ event: 'deviceUserAssign_validation_error', deviceId, userId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/users/{userId}', 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.BAD_REQUEST',
      {  correlationId: correlationId, event },
      {
        code: 'BAD_REQUEST',
        details: [{ message: 'deviceId and userId are required in path parameters' }],
      },
    );
  }

  try {
    const mapping = await deviceMappingService.assignDeviceToUser(deviceId, userId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/users/{userId}', 201, duration, correlationId);
    return ApiResponse.created(mapping, 'DEVICE.DEVICE_USER_ASSIGNED_SUCCESS', {  correlationId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceUserAssign_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/{deviceId}/users/{userId}', 500, duration, correlationId);

    if (err instanceof DeviceNotFoundError) {
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', {  correlationId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }

    return ApiResponse.internalServerError('DEVICE.ASSIGNMENT_FAILED', {  correlationId: correlationId, event }, { code: 'ASSIGNMENT_FAILED' });
  }
};

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.userAssign' }, deviceUserAssignImpl);
