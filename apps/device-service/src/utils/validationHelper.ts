import type { APIGatewayProxyEvent } from 'aws-lambda';
import { logHttpRequest } from '@api-hub/observability';
import type { Logger } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';
import type { ZodError } from 'zod';
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
    {  correlationId: correlationId, event },
    {
      code: ERROR_CODES.VALIDATION_ERROR,
      details: buildValidationDetails(error),
    },
  );
}
