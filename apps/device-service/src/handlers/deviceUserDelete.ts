import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { DeviceNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

const deviceUserDeleteImpl: any = async (event: any, context?: Context) => {
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
    return ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const bodyObj = body as Record<string, unknown>;

  // Extract userId from authorizer (Bearer token) - supports Cognito claims and custom authorizer context
  const authorizer = (event.requestContext as unknown as Record<string, unknown>)?.authorizer as Record<string, unknown> | undefined;
  const claims = (authorizer?.claims as Record<string, unknown>) || authorizer || {};
  const userId =
    (claims['custom:userID'] as string) ||
    (claims['custom:userId'] as string) ||
    (claims.userID as string) ||
    (claims.userId as string) ||
    (claims.sub as string) ||
    (authorizer?.userID as string) ||
    (authorizer?.userId as string) ||
    (bodyObj?.userID as string) ||
    (bodyObj?.userId as string);

  // Support both { deviceId: "..." } and { devices: ["..."] }
  const deviceIdSingle = typeof bodyObj?.deviceId === 'string' ? bodyObj.deviceId : undefined;
  const devicesArray = Array.isArray(bodyObj?.devices)
    ? (bodyObj.devices as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];
  const configDeviceIds = deviceIdSingle ? [deviceIdSingle] : devicesArray;

  logger.info({
    event: 'deviceUserDelete_params',
    userId: userId || undefined,
    configDeviceIds,
    hasDevicesArray: devicesArray.length > 0,
  });

  if (!userId || configDeviceIds.length === 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', {  correlationId: correlationId, event }, {
      code: 'BAD_REQUEST',
      details: [{
        message: !userId
          ? 'userId is required (from Bearer token or body)'
          : 'devices array or deviceId is required in request body',
      }],
    });
  }

  try {
    const results =
      configDeviceIds.length === 1
        ? await deviceService.deleteDevice(userId, configDeviceIds[0], correlationId).then(() => [
            { success: true, configDeviceId: configDeviceIds[0], message: 'Device deleted successfully' },
          ])
        : await deviceService.deleteMultipleDevices(userId, configDeviceIds, correlationId);
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 200, duration, correlationId);
    return ApiResponse.ok(
      configDeviceIds.length === 1 ? { message: 'Device deleted successfully' } : { results },
      'DEVICE.DEVICE_DELETED_SUCCESS',
      {  correlationId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof DeviceNotFoundError) {
      logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', {  correlationId: correlationId, event }, { code: 'DEVICE_NOT_FOUND' });
    }
    logger.error({ event: 'deviceUserDelete_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/delete', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.DELETE_FAILED', {  correlationId: correlationId, event }, { code: 'DELETE_FAILED' });
  }
};

export const handler = withApiHandler({ operation: 'device.userDelete' }, deviceUserDeleteImpl);
