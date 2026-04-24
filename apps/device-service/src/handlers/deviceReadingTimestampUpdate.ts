import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

const deviceReadingTimestampUpdateImpl: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceReadingTimestampUpdate_received' });

  // Extract userId and configDeviceId from path parameters
  const userId = event.pathParameters?.userId;
  const configDeviceId = event.pathParameters?.configDeviceId;

  if (!userId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/devices/{userId}/{configDeviceId}/update', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'userId is required in path' }] });
  }

  if (!configDeviceId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || '/devices/{userId}/{configDeviceId}/update', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'configDeviceId is required in path' }] });
  }

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceReadingTimestampUpdate_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${userId}/${configDeviceId}/update`, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Validate body contains lastReadingTimeStamp
  const bodyObj = body as Record<string, unknown>;
  const lastReadingTimeStamp = bodyObj.lastReadingTimeStamp;

  if (lastReadingTimeStamp === undefined || lastReadingTimeStamp === null) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${userId}/${configDeviceId}/update`, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'lastReadingTimeStamp is required in request body' }] });
  }

  if (typeof lastReadingTimeStamp !== 'number' || lastReadingTimeStamp < 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${userId}/${configDeviceId}/update`, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, { code: 'BAD_REQUEST', details: [{ message: 'lastReadingTimeStamp must be a valid positive number' }] });
  }

  try {
    const updatedDevice = await deviceService.updateLastReadingTimeStamp(userId, configDeviceId, lastReadingTimeStamp, correlationId);

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${userId}/${configDeviceId}/update`, 200, duration, correlationId);
    return ApiResponse.ok(
      { configDeviceId: updatedDevice.configDeviceId, lastReadingTimeStamp: updatedDevice.lastReadingTimeStamp },
      'DEVICE.READING_TIMESTAMP_UPDATED_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof DeviceNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${userId}/${configDeviceId}/update`, 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', { requestId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }
    logger.error({ event: 'deviceReadingTimestampUpdate_error', err: serializeError(err), configDeviceId, userId });
    logHttpRequest(logger, event.httpMethod || 'PUT', event.path || `/devices/${userId}/${configDeviceId}/update`, 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.READING_TIMESTAMP_UPDATE_FAILED', { requestId: correlationId, event }, { code: 'UPDATE_FAILED' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.readingTimestampUpdate', deviceReadingTimestampUpdateImpl, { serviceName: 'device-service' });
