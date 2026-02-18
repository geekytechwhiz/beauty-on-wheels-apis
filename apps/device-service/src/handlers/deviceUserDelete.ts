/**
 * Delete a single user-device mapping by userId and configDeviceId.
 * Used by vitals_sync delete_device Lambda migration.
 * Body: { userId, deviceId } where deviceId = configDeviceId
 */
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceUserDelete_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceUserDelete_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const authorizer = (event.requestContext as any)?.authorizer;
  const bodyObj = body as Record<string, unknown>;
  const userId = authorizer?.userID || authorizer?.userId || (event as any).userID || bodyObj?.userID || bodyObj?.userId;
  const deviceId = bodyObj?.deviceId;

  if (!userId || !deviceId || typeof deviceId !== 'string') {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event }, {
      code: 'BAD_REQUEST',
      details: [{ message: 'userId and deviceId (configDeviceId) are required in request body' }],
    });
  }

  try {
    await deviceService.deleteDevice(userId, deviceId, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 200, duration, correlationId);
    return ApiResponse.ok({ message: 'Device deleted successfully' }, 'DEVICE.DEVICE_DELETED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof DeviceNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', { requestId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }
    logger.error({ event: 'deviceUserDelete_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.DELETE_FAILED', { requestId: correlationId, event }, { code: 'DELETE_FAILED' });
  }
};
