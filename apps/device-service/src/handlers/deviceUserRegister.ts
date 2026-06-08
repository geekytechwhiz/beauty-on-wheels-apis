import { withApiHandler } from '@api-hub/middleware';
import { Context } from 'aws-lambda';
import { serializeError } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { deviceUserRegistrationSchema } from '../validation/device.validation';
import { createHandlerContext } from '../utils/handlerContext';
import { extractUserContext } from '../utils/authContext';
import { parseRequestBody } from '../utils/requestParser';
import { validationErrorResponse } from '../utils/validationHelper';
import { logAndRespond } from '../utils/responseHelper';
import { PATHS } from '../constants/paths';
import { HTTP_METHODS } from '../constants/httpMethods';
import { ERROR_CODES } from '../constants/errorCodes';

const deviceService = new DeviceService();

/**
 * Patient-app device user registration (legacy pairing).
 * POST body: { userID?, organizationId?, devices: [...] }
 * userId/organizationId from authorizer or body. Writes to existing table with correct mapping.
 */
const deviceUserRegisterImpl: any = async (event: any, context?: Context) => {
  const ctx = createHandlerContext(event, context);
  const { startTime, correlationId, logger } = ctx;
  const evt = ctx.event;
  logger.info({ event: 'deviceUserRegister_received' });

  const parseResult = parseRequestBody(evt.body, logger, { parseErrorEvent: 'deviceUserRegister_parse_error' });
  if (!parseResult.success) {
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.DEVICES_USER_REGISTER, statusCode: 400, startTime, correlationId },
      await ApiResponse.badRequest('COMMON.INVALID_JSON', {  correlationId: correlationId, event: evt }, { code: ERROR_CODES.BAD_REQUEST }),
    );
  }

  const body = (parseResult.body ?? {}) as Record<string, unknown>;
  const userContext = extractUserContext({
    authorizer: (evt.requestContext as { authorizer?: unknown })?.authorizer,
    body,
    event: evt,
  });

  const validationPayload = {
    userId: userContext.userId,
    organizationId: userContext.organizationId,
    devices: body?.devices,
  };

  const validation = deviceUserRegistrationSchema.safeParse(validationPayload);
  if (!validation.success) {
    return validationErrorResponse(validation.error, {
      correlationId,
      event: evt,
      logger,
      startTime,
      path: evt.path || PATHS.DEVICES_USER_REGISTER,
      method: evt.httpMethod || HTTP_METHODS.POST,
      logEventName: 'deviceUserRegister_validation_error',
    });
  }

  try {
    const { items } = await deviceService.registerOrUpdateDeviceUserFromPatientApp(validation.data, correlationId);
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.DEVICES_USER_REGISTER, statusCode: 201, startTime, correlationId },
      await ApiResponse.created({ items }, 'DEVICE.DEVICE_USER_REGISTRATION_SUCCESS', {  correlationId: correlationId, event: evt }),
    );
  } catch (err) {
    logger.error({ event: 'deviceUserRegister_error', err: serializeError(err) });
    return logAndRespond(
      { logger, method: evt.httpMethod || HTTP_METHODS.POST, path: evt.path || PATHS.DEVICES_USER_REGISTER, statusCode: 500, startTime, correlationId },
      await ApiResponse.internalServerError(
        'COMMON.INTERNAL_SERVER_ERROR',
        {  correlationId: correlationId, event: evt },
        { code: ERROR_CODES.INTERNAL_SERVER_ERROR },
      ),
    );
  }
};

export const handler = withApiHandler({ operation: 'device.userRegister' }, deviceUserRegisterImpl);
