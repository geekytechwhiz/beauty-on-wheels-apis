import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();
const globalDeviceRepository = new GlobalDeviceRepository();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceList_received' });

  // Extract query parameters (GET request) - all optional
  const queryParams = event.queryStringParameters || {};

  // Extract optional filters from query string
  const deviceId = queryParams.deviceId;
  const deviceType = queryParams.deviceType;

  // Extract user context from authorizer (optional)
  const authorizer = (event.requestContext as any)?.authorizer;
  const userId = authorizer?.userID || authorizer?.userId || queryParams.userID || queryParams.userId;

  try {
    // If userId is provided, return user-specific devices
    if (userId) {
      logger.info({ event: 'deviceList_user_devices', userId });
      const devices = await deviceService.getUserDevices(userId, {
        deviceId,
        deviceType,
      });
      const duration = Date.now() - startTime;
      logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/list', 200, duration, correlationId);
      return ApiResponse.ok(devices, 'DEVICE.DEVICE_LIST_RETRIEVED_SUCCESS', { requestId: correlationId, event });
    }

    // If no userId provided, return all global devices
    logger.info({ event: 'deviceList_all_devices' });
    let allDevices = await globalDeviceRepository.getDevicesByCategory();
    
    // Filter to only return enabled devices
    allDevices = allDevices.filter((d) => d.enabled === true);
    
    // Apply optional filters if provided
    if (deviceId) {
      allDevices = allDevices.filter((d) => d.deviceId === deviceId);
    }
    if (deviceType) {
      allDevices = allDevices.filter((d) => d.category === deviceType);
    }
    
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/list', 200, duration, correlationId);
    return ApiResponse.ok(allDevices, 'DEVICE.DEVICE_LIST_RETRIEVED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceList_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/devices/list', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.LIST_RETRIEVAL_FAILED', { requestId: correlationId, event }, { code: 'LIST_RETRIEVAL_FAILED' });
  }
};
