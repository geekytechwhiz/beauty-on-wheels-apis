import { withApiHandler } from '@api-hub/middleware';
import { createLogger, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse, BaseError, type LambdaRequest } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { deviceRegistrationSchema } from '../validation/device.validation';
import { DeviceNotInOrganizationError } from '../utils/errors';
import { completeUserTask } from '../utils/task-completion';
import { extractUserContext } from '../utils/authContext';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

// Third-party apps by companyName (matching old structure)
const ALLOWED_THIRD_PARTY_APPS = ['GOOGLEFIT', 'APPLEHEALTH', 'FITBIT', 'GARMIN', 'MANUAL'];

function resolveRegisterContext(req: LambdaRequest) {
  const parsedBody = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const fromAuthorizer = extractUserContext({
    authorizer: req.event.requestContext?.authorizer,
    body: parsedBody,
    event: req.event,
  });

  const devices = Array.isArray(parsedBody.devices) ? parsedBody.devices : [];
  const firstDevice = devices[0] as Record<string, unknown> | undefined;
  const userIdFromDevice =
    typeof firstDevice?.userId === 'string'
      ? firstDevice.userId
      : typeof firstDevice?.userID === 'string'
        ? firstDevice.userID
        : undefined;

  const userId =
    fromAuthorizer.userId ??
    req.context.userContext?.userId ??
    userIdFromDevice;
  const organizationId =
    fromAuthorizer.organizationId ??
    req.context.userContext?.organizationId;

  return { parsedBody, devices, userId, organizationId };
}

const deviceRegisterImpl = async (req: LambdaRequest) => {
  const apiEvent = req.event;
  const correlationId = req.context.correlationId;
  const logger = req.context.logger ?? createChildLogger(baseLogger, { correlationId });
  const startTime = Date.now();
  logger.info({ event: 'deviceRegister_received' });

  const { devices, userId, organizationId } = resolveRegisterContext(req);

  if (!userId || !organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, apiEvent.httpMethod || 'POST', apiEvent.path || '/devices/register', 400, duration, correlationId);
    throw new BaseError(
      'userId and organizationId are required',
      400,
      'VALIDATION_ERROR',
      [{ field: 'userId/organizationId', message: 'userId and organizationId are required' }],
      { retryable: false },
    );
  }

  if (devices.length === 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, apiEvent.httpMethod || 'POST', apiEvent.path || '/devices/register', 400, duration, correlationId);
    throw new BaseError(
      'devices array is required',
      400,
      'VALIDATION_ERROR',
      [{ field: 'devices', message: 'devices array is required' }],
      { retryable: false },
    );
  }

  const messageArr: Array<{
    message?: string;
    statusCode: number;
    configDeviceId: string;
    deviceId?: string;
    errorCode?: string;
    success?: boolean;
  }> = [];
  let isRealDevice = false;

  try {
    for (const device of devices) {
      try {
        const deviceValidation = deviceRegistrationSchema.shape.devices.element.safeParse(device);
        if (!deviceValidation.success) {
          logger.warn({ event: 'device_validation_error', configDeviceId: device.configDeviceId, errors: deviceValidation.error.issues });
          messageArr.push({
            statusCode: 400,
            configDeviceId: device.configDeviceId || '',
            errorCode: 'VALIDATION_ERROR',
            success: false,
            message: deviceValidation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          });
          continue;
        }

        const isThirdParty = device.companyName && ALLOWED_THIRD_PARTY_APPS.includes(device.companyName.toUpperCase());
        const registerPayload = {
          userId,
          organizationId,
          configDeviceId: device.configDeviceId,
          displayName: device.displayName,
          deviceCategory: device.deviceCategory,
          companyName: device.companyName,
          modelName: device.modelName,
          deviceCategoryNum: device.deviceCategoryNum,
          platform: device.platform,
          macAddress: device.macAddress,
          localName: device.localName,
          isAutoSyncEnabled: device.isAutoSyncEnabled,
          isAutoSyncSupported: device.isAutoSyncSupported,
          isSync: device.isSync,
          usesExtensionProtocol: device.usesExtensionProtocol,
          supportsUserAuthentication: device.supportsUserAuthentication,
          autoSyncDelay: device.autoSyncDelay,
          userIndex: device.userIndex,
          noOfUsers: device.noOfUsers,
          lastReadingTimeStamp: device.lastReadingTimeStamp,
          lastSequenceNumber: device.lastSequenceNumber,
          databaseUpdateFlag: device.databaseUpdateFlag,
          databaseChangeIncrement: device.databaseChangeIncrement,
          isDeviceDeleted: device.isDeviceDeleted,
          iOSIdentifier: device.iOSIdentifier,
          isEagleDevice: device.isEagleDevice,
        };

        const result = await deviceService.registerDevice(registerPayload, correlationId);

        messageArr.push({
          message: result.isUpdate ? 'Device updated successfully' : 'Device successfully paired with the user',
          statusCode: 201,
          configDeviceId: result.configDeviceId,
          deviceId: result.deviceId,
        });

        if (!isThirdParty) {
          isRealDevice = true;
        }
      } catch (err) {
        logger.error({ event: 'device_register_error', configDeviceId: device.configDeviceId, err: serializeError(err) });

        if (err instanceof DeviceNotInOrganizationError) {
          messageArr.push({
            statusCode: 400,
            configDeviceId: device.configDeviceId || '',
            errorCode: 'DEVICE_NOT_AVAILABLE_TO_PAIR',
            success: false,
            message: err.message,
          });
        } else {
          messageArr.push({
            statusCode: 500,
            configDeviceId: device.configDeviceId || '',
            errorCode: 'REGISTRATION_FAILED',
            success: false,
            message: (err as Error).message || 'Device registration failed',
          });
        }
      }
    }

    if (isRealDevice) {
      try {
        await completeUserTask(userId, organizationId, correlationId);
      } catch (err) {
        logger.warn({ event: 'task_completion_failed', err: serializeError(err) });
      }
    }

    const duration = Date.now() - startTime;
    const hasErrors = messageArr.some((msg) => msg.statusCode >= 400);
    const allSucceeded = messageArr.length > 0 && messageArr.every((msg) => msg.statusCode < 400);
    const statusCode = allSucceeded
      ? 201
      : hasErrors
        ? messageArr.some((msg) => msg.statusCode >= 500)
          ? 500
          : 400
        : 201;
    logHttpRequest(logger, apiEvent.httpMethod || 'POST', apiEvent.path || '/devices/register', statusCode, duration, correlationId);

    if (!allSucceeded) {
      throw new BaseError(
        'One or more devices failed to register',
        statusCode,
        statusCode >= 500 ? 'REGISTRATION_FAILED' : 'VALIDATION_ERROR',
        undefined,
        { retryable: false, metadata: { items: messageArr } },
      );
    }

    return ApiResponse.created(
      { items: messageArr },
      'DEVICE.DEVICE_REGISTRATION_SUCCESS',
      { correlationId, event: apiEvent },
    );
  } catch (err) {
    if (err instanceof BaseError) {
      throw err;
    }
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceRegister_error', err: serializeError(err) });
    logHttpRequest(logger, apiEvent.httpMethod || 'POST', apiEvent.path || '/devices/register', 500, duration, correlationId);
    throw new BaseError(
      'An unexpected error occurred',
      500,
      'INTERNAL_SERVER_ERROR',
      [{ message: (err as Error).message || 'Device registration failed' }],
      { retryable: false },
    );
  }
};

export const handler = withApiHandler({   useLegacyResponseFormat: true, operation: 'device.register' }, deviceRegisterImpl);
