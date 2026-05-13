import { withStandardApiGatewayPipeline } from '@api-hub/middleware';
import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { deviceRegistrationSchema } from '../validation/device.validation';
import { DeviceNotFoundError, DeviceNotInOrganizationError } from '../utils/errors';
import { completeUserTask } from '../utils/task-completion';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

// Third-party apps by companyName (matching old structure)
const ALLOWED_THIRD_PARTY_APPS = ['GOOGLEFIT', 'APPLEHEALTH', 'FITBIT', 'GARMIN', 'MANUAL'];

const deviceRegisterImpl: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceRegister_received' });

  // Parse body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceRegister_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 400, duration, correlationId);
    return ApiResponse.badRequest({ title: 'COMMON.INVALID_JSON', description: 'Request body is not valid JSON', severity: 'ERROR' }, { requestId: correlationId }, { code: 'BAD_REQUEST' });
  }

  // Extract user context from authorizer (Cognito)
  const authorizer = (event.requestContext as any)?.authorizer;
  // console.log('AUTHORIZER ', authorizer);

  // For Cognito, claims are usually under authorizer.claims
  const claims = (authorizer as any)?.claims || authorizer || {};

  const userId =
    (claims as any)['custom:userID'] ||
    (claims as any)['custom:userId'] ||
    (claims as any).userID ||
    (claims as any).userId ||
    (claims as any).sub ||
    (body as any).userId ||
    (body as any).userID;

  const organizationId =
    (claims as any)['custom:organizationID'] ||
    (claims as any)['custom:organizationId'] ||
    (claims as any).organizationID ||
    (claims as any).organizationId ||
    (body as any).organizationId ||
    (body as any).organizationID;

  // console.log('USER ID ', userId);
  // console.log('ORGANIZATION ID ', organizationId);

  // Basic validation - check required fields
  if (!userId || !organizationId) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 400, duration, correlationId);
    return ApiResponse.badRequest({ title: 'COMMON.VALIDATION_ERROR', description: 'userId and organizationId are required', severity: 'ERROR' }, { requestId: correlationId }, { code: 'VALIDATION_ERROR', details: [{ field: 'userId/organizationId', message: 'userId and organizationId are required' }] });
  }

  const devices = (body as any)?.devices;
  if (!devices || !Array.isArray(devices) || devices.length === 0) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 400, duration, correlationId);
    return ApiResponse.badRequest({ title: 'COMMON.VALIDATION_ERROR', description: 'devices array is required', severity: 'ERROR' }, { requestId: correlationId }, { code: 'VALIDATION_ERROR', details: [{ field: 'devices', message: 'devices array is required' }] });
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
    // Process each device individually (matching old structure)
    for (const device of devices) {
      try {
        // Per-device validation (matching old structure)
        const deviceValidation = deviceRegistrationSchema.shape.devices.element.safeParse(device);
        if (!deviceValidation.success) {
          logger.warn({ event: 'device_validation_error', configDeviceId: device.configDeviceId, errors: deviceValidation.error.issues });
          messageArr.push({
            statusCode: 400,
            configDeviceId: device.configDeviceId || '',
            errorCode: 'VALIDATION_ERROR',
            success: false,
            message: deviceValidation.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', '),
          });
          continue;
        }

        // Check if third-party app by companyName (matching old structure)
        const isThirdParty = device.companyName && ALLOWED_THIRD_PARTY_APPS.includes(device.companyName.toUpperCase());

        if (isThirdParty) {
          // Third-party device - register directly
          const result = await deviceService.registerDevice(
            {
              userId,
              organizationId,
              configDeviceId: device.configDeviceId,
              displayName: device.displayName,
              deviceCategory: device.deviceCategory,
              companyName: device.companyName,
              modelName: device.modelName,
              deviceCategoryNum: device.deviceCategoryNum,
              // Optional fields
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
            },
            correlationId,
          );

          messageArr.push({
            message: result.isUpdate ? 'Device updated successfully' : 'Device successfully paired with the user',
            statusCode: 201,
            configDeviceId: result.configDeviceId,
            deviceId: result.deviceId,
          });
        } else {
          // Non-third-party device - check if available (service will check org devices and global device list)
          // Register device (service handles validation)
          const result = await deviceService.registerDevice(
            {
              userId,
              organizationId,
              configDeviceId: device.configDeviceId,
              displayName: device.displayName,
              deviceCategory: device.deviceCategory,
              companyName: device.companyName,
              modelName: device.modelName,
              deviceCategoryNum: device.deviceCategoryNum,
              // Optional fields
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
            },
            correlationId,
          );

          messageArr.push({
            message: result.isUpdate ? 'Device updated successfully' : 'Device successfully paired with the user',
            statusCode: 201,
            configDeviceId: result.configDeviceId,
            deviceId: result.deviceId,
          });

          isRealDevice = true; // Mark that at least one real device was registered
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

    // Trigger task completion only once if at least one real device was registered (matching old structure)
    if (isRealDevice) {
      try {
        await completeUserTask(userId, organizationId, correlationId);
      } catch (err) {
        // Don't fail the entire request if task completion fails
        logger.warn({ event: 'task_completion_failed', err: serializeError(err) });
      }
    }

    const duration = Date.now() - startTime;
    const hasErrors = messageArr.some((msg) => msg.statusCode >= 400);
    const statusCode = hasErrors ? (messageArr.some((msg) => msg.statusCode >= 500) ? 500 : 400) : 201;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', statusCode, duration, correlationId);
    
    return ApiResponse.created(
      { items: messageArr },
      { title: 'DEVICE.DEVICE_USER_REGISTRATION_SUCCESS', description: 'Device registration processed successfully', severity: 'SUCCESS' },
      { requestId: correlationId },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceRegister_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 500, duration, correlationId);
    return ApiResponse.internalServerError({ title: 'COMMON.INTERNAL_SERVER_ERROR', description: 'An unexpected error occurred', severity: 'ERROR' }, { requestId: correlationId }, { code: 'INTERNAL_SERVER_ERROR' });
  }
};

export const handler = withStandardApiGatewayPipeline('device.register', deviceRegisterImpl, { serviceName: 'device-service' });
