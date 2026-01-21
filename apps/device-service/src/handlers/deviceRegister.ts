import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { deviceRegistrationSchema } from '../validation/device.validation';
import { DeviceNotFoundError, DeviceNotInOrganizationError } from '../utils/errors';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
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
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  // Extract user context from authorizer (Cognito)
  const authorizer = (event.requestContext as any)?.authorizer;
  console.log('AUTHORIZER ', authorizer);

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

  console.log('USER ID ', userId);
  console.log('ORGANIZATION ID ', organizationId);

  // Build payload for validation
  const validationPayload = {
    userId,
    organizationId,
    devices: (body as any)?.devices,
  };
  console.log("VALIDATION PAYLOAD ", validationPayload);
  // Validation
  const validation = deviceRegistrationSchema.safeParse(validationPayload);
  if (!validation.success) {
    logger.warn({ event: 'deviceRegister_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 400, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    // Register each device
    const results = await Promise.all(
      validation.data.devices.map(async (device) => {
        try {
          const result = await deviceService.registerDevice(
            {
              userId: validation.data.userId,
              organizationId: validation.data.organizationId,
              ...device,
            } as any,
            correlationId,
          );
          return {
            message: 'Device successfully registered',
            statusCode: 201,
            configDeviceId: result.configDeviceId,
            deviceId: result.deviceId,
          };
        } catch (err) {
          logger.error({ event: 'device_register_error', configDeviceId: device.configDeviceId, err: serializeError(err) });
          throw err;
        }
      }),
    );

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 201, duration, correlationId);
    return ApiResponse.created(results, 'DEVICE.DEVICE_REGISTERED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceRegister_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/register', 500, duration, correlationId);
    return ApiResponse.internalServerError('DEVICE.REGISTRATION_FAILED', { requestId: correlationId, event }, { code: 'REGISTRATION_FAILED' });
  }
};
