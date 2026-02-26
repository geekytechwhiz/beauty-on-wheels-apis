import type { APIGatewayProxyEvent } from 'aws-lambda';
import { logHttpRequest } from '@api-hub/logger';
import type { Logger } from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import type { ZodError } from 'zod';
import { HTTP_METHODS } from '../constants/httpMethods';
import { ERROR_CODES } from '../constants/errorCodes';

export interface ValidationErrorOptions {
  correlationId: string;
  event: APIGatewayProxyEvent;
  logger: Logger;
  startTime: number;
  path: string;
  method: string;
  logEventName: string;
}

/**
 * Builds the details array for validation error responses (field + message per issue).
 */
export function buildValidationDetails(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((e) => ({
    field: e.path.join('.'),
    message: e.message,
  }));
}

/**
 * Logs validation failure, logs HTTP 422, and returns ApiResponse.unprocessableEntity.
 * Use when schema.safeParse() fails to keep response shape and status code consistent.
 */
export function validationErrorResponse(
  error: ZodError,
  options: ValidationErrorOptions,
): ReturnType<typeof ApiResponse.unprocessableEntity> {
  const { correlationId, event, logger, startTime, path, method, logEventName } = options;
  logger.warn({ event: logEventName, errors: error.issues });
  const duration = Date.now() - startTime;
  logHttpRequest(logger, method, path, 422, duration, correlationId);
  return ApiResponse.unprocessableEntity(
    'COMMON.VALIDATION_ERROR',
    { requestId: correlationId, event },
    {
      code: ERROR_CODES.VALIDATION_ERROR,
      details: buildValidationDetails(error),
    },
  );
}
