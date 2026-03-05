import { APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';
import { ApiResponse } from '@api-hub/utils';
import { serializeError, logHttpRequest, type Logger } from '@api-hub/logger';
import { PATHS } from '../constants/paths';
import { ERROR_CODES } from '../constants/errorCodes';
import { HTTP_METHODS } from '../constants/httpMethods';
import {
  DeviceNotFoundError,
  DeviceNotInOrganizationError,
} from './errors';

/** Context passed to error handlers for consistent response and logging. */
export interface DeviceRegistrationErrorContext {
  correlationId: string;
  event: APIGatewayProxyEvent | undefined;
  path?: string;
  method?: string;
}

/** Signature for logHttpRequest used by error handler. */
export type LogHttpRequestFn = (
  logger: Logger,
  method: string,
  path: string,
  statusCode: number,
  duration: number,
  correlationId: string,
) => void;

/** Result of mapping a domain error to an HTTP response (for future use). */
export interface MappedErrorResponse {
  statusCode: number;
  messageKey: string;
  code: string;
}

/**
 * Maps known domain errors to HTTP response parameters.
 * Used by generic error handling; device registration currently preserves 500 for all errors.
 *
 * @param err - Caught error
 * @returns MappedErrorResponse or null if error should result in 500
 */
export function mapDomainErrorToResponse(err: unknown): MappedErrorResponse | null {
  if (err instanceof DeviceNotFoundError) {
    return { statusCode: 404, messageKey: 'DEVICE.DEVICE_NOT_FOUND', code: 'DEVICE_NOT_FOUND' };
  }
  if (err instanceof DeviceNotInOrganizationError) {
    return { statusCode: 400, messageKey: 'DEVICE.DEVICE_NOT_IN_ORGANIZATION', code: 'DEVICE_NOT_IN_ORGANIZATION' };
  }
  return null;
}

/**
 * Handles device registration errors and returns the appropriate ApiResponse.
 * Preserves exact external contract: 500, DEVICE.REGISTRATION_FAILED, code REGISTRATION_FAILED.
 *
 * @param err - Caught error from business logic
 * @param context - CorrelationId, event, path, method
 * @param logHttpRequest - Logger for HTTP request metrics
 * @param logger - Structured logger for error details
 * @param startTime - Handler start time for duration
 * @returns Promise resolving to APIGatewayProxyResult (500)
 */
export async function handleDeviceRegistrationError(
  err: unknown,
  context: DeviceRegistrationErrorContext,
  logHttpRequest: LogHttpRequestFn,
  logger: Logger,
  startTime: number,
): Promise<APIGatewayProxyResult> {
  const duration = Date.now() - startTime;
  const path = context.path ?? PATHS.DEVICES_REGISTER;
  const method = context.method ?? HTTP_METHODS.POST;

  logger.error({ event: 'deviceRegister_error', err: serializeError(err) });
  logHttpRequest(logger, method, path, 500, duration, context.correlationId);

  return ApiResponse.internalServerError(
    'DEVICE.REGISTRATION_FAILED',
    { requestId: context.correlationId, event: context.event },
    { code: ERROR_CODES.REGISTRATION_FAILED },
  );
}

/** Domain error mapping: Error constructor -> HTTP response params. */
export type DomainErrorMapping = Array<
  [new (message?: string) => Error, { statusCode: number; messageKey: string; code: string }]
>;

export interface GenericHandlerErrorOptions {
  correlationId: string;
  event: APIGatewayProxyEvent | undefined;
  path: string;
  method: string;
  startTime: number;
  logger: Logger;
  logEventName: string;
  defaultMessageKey: string;
  defaultCode: string;
  domainMap: DomainErrorMapping;
}

/**
 * Generic handler error handler: map domain errors to HTTP responses, else 500.
 * Logs error, logs HTTP request with correct status, returns ApiResponse.
 * Use in catch blocks for handlers that have domain-specific error mapping.
 */
export async function handleHandlerError(
  err: unknown,
  options: GenericHandlerErrorOptions,
): Promise<APIGatewayProxyResult> {
  const { correlationId, event, path, method, startTime, logger, logEventName, defaultMessageKey, defaultCode, domainMap } = options;
  const duration = Date.now() - startTime;

  for (const [ErrorClass, { statusCode, messageKey, code }] of domainMap) {
    if (err instanceof ErrorClass) {
      logHttpRequest(logger, method, path, statusCode, duration, correlationId);
      const response =
        statusCode === 404
          ? ApiResponse.notFound(messageKey, { requestId: correlationId, event }, { code })
          : statusCode === 400
            ? ApiResponse.badRequest(messageKey, { requestId: correlationId, event }, { code })
            : statusCode === 409
              ? ApiResponse.conflict(messageKey, { requestId: correlationId, event }, { code })
              : ApiResponse.internalServerError(messageKey, { requestId: correlationId, event }, { code });
      return response;
    }
  }

  logger.error({ event: logEventName, err: serializeError(err) });
  logHttpRequest(logger, method, path, 500, duration, correlationId);
  return ApiResponse.internalServerError(
    defaultMessageKey,
    { requestId: correlationId, event },
    { code: defaultCode },
  );
}
