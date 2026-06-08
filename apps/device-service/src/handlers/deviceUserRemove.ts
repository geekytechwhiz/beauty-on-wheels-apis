import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { DeviceMappingService } from '../services/deviceMappingService';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceMappingService = new DeviceMappingService();

const deviceUserRemoveImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceUserRemove_received' });

  // Extract path parameters
  const deviceId = event.pathParameters?.deviceId;
  const userId = event.pathParameters?.userId;

  // Validate path parameters
  if (!deviceId || !userId) {
    logger.warn({ event: 'deviceUserRemove_validation_error', deviceId, userId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}/users/{userId}', 400, duration, correlationId);
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
    await deviceMappingService.removeDeviceFromUser(deviceId, userId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}/users/{userId}', 200, duration, correlationId);
    return ApiResponse.ok(null, 'DEVICE.DEVICE_USER_REMOVED_SUCCESS', {  correlationId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceUserRemove_error', err: serializeError(err) });

    const errorMessage = (err as Error).message;
    if (errorMessage.includes('not found')) {
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}/users/{userId}', 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_USER_MAPPING_NOT_FOUND', {  correlationId: correlationId, event }, { code: 'MAPPING_NOT_FOUND' });
    }

    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}/users/{userId}', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.REMOVAL_FAILED', {  correlationId: correlationId, event }, { code: 'REMOVAL_FAILED' });
  }
};

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.userRemove' }, deviceUserRemoveImpl);
