import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { deviceUserRegistrationSchema } from '../validation/device.validation';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

/**
 * Patient-app device user registration (legacy pairing).
 * POST body: { userID?, organizationId?, devices: [{ configDeviceId, displayName, noOfUsers, deviceCategory, companyName, modelName, ... }] }
 * userId/organizationId from authorizer or body. Writes to existing table with correct mapping:
 * pk=DEVICE_LIST#userId, sk=DETAILS#configDeviceId, sk1=DEVICE#deviceCategory, sk2=STATUS#ACTIVE.
 */
export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceUserRegister_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'deviceUserRegister_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/register', 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: 'BAD_REQUEST' });
  }

  const authorizer = (event.requestContext as { authorizer?: unknown })?.authorizer;
  const claims = (authorizer as { claims?: Record<string, unknown> })?.claims || (authorizer as Record<string, unknown>) || {};
  const b = body as Record<string, unknown>;

  const userId =
    (claims['custom:userID'] as string) ||
    (claims['custom:userId'] as string) ||
    (claims.userID as string) ||
    (claims.userId as string) ||
    (claims.sub as string) ||
    (b.userId as string) ||
    (b.userID as string);

  const organizationId =
    (claims['custom:organizationID'] as string) ||
    (claims['custom:organizationId'] as string) ||
    (claims.organizationID as string) ||
    (claims.organizationId as string) ||
    (b.organizationId as string) ||
    (b.organizationID as string);

  const validationPayload = {
    userId,
    organizationId,
    devices: b?.devices,
  };

  const validation = deviceUserRegistrationSchema.safeParse(validationPayload);
  if (!validation.success) {
    logger.warn({ event: 'deviceUserRegister_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/register', 422, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validation.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const { items } = await deviceService.registerOrUpdateDeviceUserFromPatientApp(
      validation.data,
      correlationId,
    );

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/register', 201, duration, correlationId);
    return ApiResponse.created(
      { items },
      'DEVICE.DEVICE_USER_REGISTRATION_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'deviceUserRegister_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', event.path || '/devices/user/register', 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
};
