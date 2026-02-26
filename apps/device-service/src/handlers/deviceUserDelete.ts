/**
 * Delete a single user-device mapping by userId and configDeviceId.
 * Body: { userId?, deviceId } where deviceId = configDeviceId (from authorizer or body).
 */
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { createHandlerContext } from '../utils/handlerContext';
import { extractUserContext } from '../utils/authContext';
import { parseRequestBody } from '../utils/requestParser';
import { logAndRespond } from '../utils/responseHelper';
import { handleHandlerError } from '../utils/errorHandler';
import { DeviceNotFoundError } from '../utils/errors';
import { PATHS } from '../constants/paths';
import { HTTP_METHODS } from '../constants/httpMethods';
import { ERROR_CODES } from '../constants/errorCodes';

const deviceService = new DeviceService();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const ctx = createHandlerContext(event, context);
  const { startTime, correlationId, logger } = ctx;
  const evt = ctx.event;
  logger.info({ event: 'deviceUserDelete_received' });

  const parseResult = parseRequestBody(evt.body, logger, { parseErrorEvent: 'deviceUserDelete_parse_error' });
  if (!parseResult.success) {
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.DEVICES_USER_DELETE, statusCode: 400, startTime, correlationId },
      await ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event: evt }, { code: ERROR_CODES.BAD_REQUEST }),
    );
  }

  const body = (parseResult.body ?? {}) as Record<string, unknown>;
  const userContext = extractUserContext({
    authorizer: (evt.requestContext as { authorizer?: unknown })?.authorizer,
    body,
  });
  const userId = userContext.userId ?? (body.userID as string) ?? (body.userId as string);
  const deviceId = body.deviceId as string | undefined;

  if (!userId || !deviceId || typeof deviceId !== 'string') {
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.DEVICES_USER_DELETE, statusCode: 400, startTime, correlationId },
      await ApiResponse.badRequest('COMMON.BAD_REQUEST', { requestId: correlationId, event: evt }, {
        code: ERROR_CODES.BAD_REQUEST,
        details: [{ message: 'userId and deviceId (configDeviceId) are required in request body' }],
      }),
    );
  }

  try {
    await deviceService.deleteDevice(userId, deviceId, correlationId);
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.DEVICES_USER_DELETE, statusCode: 200, startTime, correlationId },
      await ApiResponse.ok({ message: 'Device deleted successfully' }, 'DEVICE.DEVICE_DELETED_SUCCESS', { requestId: correlationId, event: evt }),
    );
  } catch (err) {
    return handleHandlerError(err, {
      correlationId,
      event: evt,
      path: evt.path || PATHS.DEVICES_USER_DELETE,
      method: evt.httpMethod || HTTP_METHODS.POST,
      startTime,
      logger,
      logEventName: 'deviceUserDelete_error',
      defaultMessageKey: 'DEVICE.DELETE_FAILED',
      defaultCode: ERROR_CODES.DELETE_FAILED,
      domainMap: [
        [DeviceNotFoundError, { statusCode: 404, messageKey: 'DEVICE.DEVICE_NOT_FOUND', code: ERROR_CODES.DEVICE_NOT_FOUND }],
      ],
    });
  }
};
