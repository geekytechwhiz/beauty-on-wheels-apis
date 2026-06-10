import { withApiHandler } from '@api-hub/middleware';
import { createLogger, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse, type LambdaRequest } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { DeviceNotFoundError } from '../utils/errors';
import { extractUserContext } from '../utils/authContext';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

const deviceUserDeleteImpl = async (req: LambdaRequest) => {
  const apiEvent = req.event;
  const correlationId = req.context.correlationId;
  const logger = req.context.logger ?? createChildLogger(baseLogger, { correlationId });
  const startTime = Date.now();
  logger.info({ event: 'deviceUserDelete_received' });

  const bodyObj =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};

  const fromAuthorizer = extractUserContext({
    authorizer: apiEvent.requestContext?.authorizer,
    body: bodyObj,
    event: apiEvent,
  });
  const userId = fromAuthorizer.userId ?? req.context.userContext?.userId;

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
    logHttpRequest(logger, apiEvent.httpMethod || 'POST', apiEvent.path || '/devices/user/delete', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.BAD_REQUEST', { correlationId, event: apiEvent }, {
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
    logHttpRequest(logger, apiEvent.httpMethod || 'POST', apiEvent.path || '/devices/user/delete', 200, duration, correlationId);
    return ApiResponse.ok(
      configDeviceIds.length === 1 ? { message: 'Device deleted successfully' } : { results },
      'DEVICE.DEVICE_DELETED_SUCCESS',
      { correlationId, event: apiEvent },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    if (err instanceof DeviceNotFoundError) {
      logHttpRequest(logger, apiEvent.httpMethod || 'POST', apiEvent.path || '/devices/user/delete', 404, duration, correlationId);
      return ApiResponse.notFound('DEVICE.DEVICE_NOT_FOUND', { correlationId, event: apiEvent }, { code: 'DEVICE_NOT_FOUND' });
    }
    logger.error({ event: 'deviceUserDelete_error', err: serializeError(err) });
    logHttpRequest(logger, apiEvent.httpMethod || 'POST', apiEvent.path || '/devices/user/delete', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.DELETE_FAILED', { correlationId, event: apiEvent }, { code: 'DELETE_FAILED' });
  }
};

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.userDelete' }, deviceUserDeleteImpl);
