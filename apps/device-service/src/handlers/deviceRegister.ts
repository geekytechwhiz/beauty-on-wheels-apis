import { APIGatewayProxyHandler, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { DeviceService } from '../services/deviceService';
import { deviceRegistrationSchema } from '../validation/device.validation';
import { extractUserContext, validateUserContext } from '../utils/authContext';
import { parseRequestBody } from '../utils/requestParser';
import { handleDeviceRegistrationError, type LogHttpRequestFn } from '../utils/errorHandler';
import { registerDevices } from './helpers/deviceRegistration.helper';
import { PATHS } from '../constants/paths';
import { HTTP_METHODS } from '../constants/httpMethods';
import { ERROR_CODES } from '../constants/errorCodes';
import type { UserContext, DeviceRegistrationValidationPayload, ValidUserContext } from '../types/deviceRegistration.types';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });
const deviceService = new DeviceService();

/**
 * Device registration handler (POST /devices/register).
 * Parses body, validates user context and payload, registers each device, returns 201 with result items.
 * Preserves exact request/response contract and status codes.
 */
export const handler: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  logger.info({ event: 'deviceRegister_received' });

  const parseResult = parseRequestBody(event.body, logger, { parseErrorEvent: 'deviceRegister_parse_error' });
  if (!parseResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || HTTP_METHODS.POST, event.path || PATHS.DEVICES_REGISTER, 400, duration, correlationId);
    return ApiResponse.badRequest('COMMON.INVALID_JSON', { requestId: correlationId, event }, { code: ERROR_CODES.BAD_REQUEST });
  }

  const body = parseResult.body as Record<string, unknown> | undefined;
  const authorizer = (event.requestContext as { authorizer?: unknown })?.authorizer;
  logger.debug({ event: 'deviceRegister_authorizer', authorizer });

  const userContext: UserContext = extractUserContext({
    authorizer,
    body: body ?? {},
  });
  logger.debug({ event: 'deviceRegister_user_context', userId: userContext.userId, organizationId: userContext.organizationId });

  if (!validateUserContext(userContext)) {
    logger.warn({ event: 'deviceRegister_missing_required_context', userId: userContext.userId, organizationId: userContext.organizationId });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || HTTP_METHODS.POST, event.path || PATHS.DEVICES_REGISTER, 401, duration, correlationId);
    return ApiResponse.unauthorized('COMMON.UNAUTHORIZED', { requestId: correlationId, event }, { code: ERROR_CODES.UNAUTHORIZED });
  }

  const validatedContext = userContext as ValidUserContext;
  const validationPayload: DeviceRegistrationValidationPayload = {
    userId: validatedContext.userId,
    organizationId: validatedContext.organizationId,
    devices: body?.devices,
  };
  logger.debug({ event: 'deviceRegister_validation_payload', validationPayload });

  const validation = deviceRegistrationSchema.safeParse(validationPayload);
  if (!validation.success) {
    logger.warn({ event: 'deviceRegister_validation_error', errors: validation.error.issues });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || HTTP_METHODS.POST, event.path || PATHS.DEVICES_REGISTER, 422, duration, correlationId);
    return ApiResponse.unprocessableEntity(
      'COMMON.VALIDATION_ERROR',
      { requestId: correlationId, event },
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        details: validation.error.issues.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    );
  }

  try {
    const results = await registerDevices({
      validatedPayload: validation.data,
      deviceService,
      correlationId,
      logger,
    });

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || HTTP_METHODS.POST, event.path || PATHS.DEVICES_REGISTER, 201, duration, correlationId);
    return ApiResponse.created(results, 'DEVICE.DEVICE_REGISTERED_SUCCESS', { requestId: correlationId, event });
  } catch (err) {
    return await handleDeviceRegistrationError(
      err,
      { correlationId, event, path: event.path || PATHS.DEVICES_REGISTER, method: event.httpMethod || HTTP_METHODS.POST },
      logHttpRequest as LogHttpRequestFn,
      logger,
      startTime,
    );
  }
};
