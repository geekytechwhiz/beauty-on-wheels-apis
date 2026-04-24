import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { GlobalDeviceRepository } from '../repositories/globalDeviceRepository';
import { DeviceNotFoundError, DeviceAlreadyDeletedError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const globalDeviceRepository = new GlobalDeviceRepository();

const deviceDeleteImpl: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceDelete_received' });

  // Extract deviceId from path parameters
  const deviceId = event.pathParameters?.deviceId;
  if (!deviceId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || '/devices/{deviceId}', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'deviceId is required in path' }] });
  }

  try {
    // Soft delete: Set enabled to false in device table
    const deletedDevice = await globalDeviceRepository.softDeleteDevice(deviceId);
    
    // Return the deleted device information
    const responseData = {
      deviceId: deletedDevice.deviceId,
      name: deletedDevice.name,
      category: deletedDevice.category,
      enabled: deletedDevice.enabled,
    };
    
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/devices/${deviceId}`, 200, duration, correlationId);
    return ApiResponse.ok(responseData, 'DEVICE.DEVICE_DELETED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof DeviceNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/devices/${deviceId}`, 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', { requestId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }
    if (err instanceof DeviceAlreadyDeletedError) {
      logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/devices/${deviceId}`, 409, duration, correlationId);
      return ApiResponse.conflict('DEVICE.DEVICE_ALREADY_DELETED', { requestId: correlationId, event }, { code: 'DEVICE_ALREADY_DELETED', details: [{ message: err.message }] });
    }
    logger.error({ event: 'deviceDelete_error', err: serializeError(err), deviceId });
    logHttpRequest(logger, event.httpMethod || 'DELETE', event.path || `/devices/${deviceId}`, 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.DELETE_FAILED', { requestId: correlationId, event }, { code: 'DELETE_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.delete', deviceDeleteImpl, { serviceName: 'device-service' });
