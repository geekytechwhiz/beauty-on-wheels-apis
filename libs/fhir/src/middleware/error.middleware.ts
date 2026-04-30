import { APIGatewayProxyResult } from 'aws-lambda';
import { serializeError } from '@api-hub/logger';

import { AppError } from '@api-hub/utils';
import { ErrorHandlerOptions, Message } from '@api-hub/utils';
import { ApiResponse } from '@api-hub/utils';

/**
 * Maps application errors → standardized HTTP response
 */
export function handleError(
  error: AppError,
  options: ErrorHandlerOptions = {}
): APIGatewayProxyResult {

  const { correlationId, logger } = options;

  const statusCode = error?.statusCode ?? 500;
  const errorCode = error?.code ?? mapStatusToCode(statusCode);
  const description = error?.message ?? 'Unexpected server error';

  const requestId = correlationId ?? 'unknown';

  /**
   * Structured logging
   */
  if (logger) {
    logger.error({
      event: 'lambda_error',
      requestId,
      statusCode,
      errorCode,
      error: serializeError(error),
    });
  }

  const message: Message = {
    title: errorCode,
    description,
    severity: 'ERROR',
  };

  const errorPayload = {
    code: errorCode,
    details: error?.details ?? [{ message: description }],
  };

  const optionsPayload = { requestId };

  switch (statusCode) {

    case 400:
      return ApiResponse.badRequest(
        message,
        optionsPayload,
        errorPayload
      );

    case 401:
      return ApiResponse.unauthorized(
        message,
        optionsPayload,
        errorPayload
      );

    case 403:
      return ApiResponse.forbidden(
        message,
        optionsPayload,
        errorPayload
      );

    case 404:
      return ApiResponse.notFound(
        message,
        optionsPayload,
        errorPayload
      );

    case 409:
      return ApiResponse.conflict(
        message,
        optionsPayload,
        errorPayload
      );

    default:
      return ApiResponse.internalServerError(
        message,
        optionsPayload,
        errorPayload
      );
  }
}

/**
 * Default mapping when error does not provide a code
 */
function mapStatusToCode(statusCode: number): string {

  switch (statusCode) {

    case 400:
      return 'INVALID_REQUEST';

    case 401:
      return 'UNAUTHORIZED';

    case 403:
      return 'FORBIDDEN';

    case 404:
      return 'RESOURCE_NOT_FOUND';

    case 409:
      return 'CONFLICT';

    default:
      return 'INTERNAL_SERVER_ERROR';
  }
}