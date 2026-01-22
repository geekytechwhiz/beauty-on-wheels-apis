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
  logger.info({ event: 'deviceUserList_received' });

  // Extract path parameters
  const deviceId = event.pathParameters?.deviceId;

  // Validate path parameters
  if (!deviceId) {
    logger.warn({ event: 'deviceUserList_validation_error', deviceId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/{deviceId}/users', 400, duration, correlationId);
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
    const users = await deviceMappingService.listDeviceUsers(deviceId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/{deviceId}/users', 200, duration, correlationId);
    return ApiResponse.ok(users, 'DEVICE.DEVICE_USERS_LISTED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceUserList_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/{deviceId}/users', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.LIST_RETRIEVAL_FAILED', { requestId: correlationId, event }, { code: 'LIST_RETRIEVAL_FAILED' });
  }
};
