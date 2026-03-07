import { DomainError } from "../errors/domain-error";
import { ApiResponse } from "../helper/api-response";

export async function handleError(
  error: any,
  context: any
) {
  const { logger, event, correlationId } = context;

  logger.error({
    message: error.message,
    code: error.code,
    stack: error.stack,
  });

  if (error instanceof DomainError) {
    switch (error.statusCode) {
      case 400:
        return ApiResponse.badRequest(event, error.code, { requestId: correlationId });

      case 401:
        return ApiResponse.unauthorized(event, error.code, { requestId: correlationId });

      case 403:
        return ApiResponse.forbidden(event, error.code, { requestId: correlationId });

      case 404:
        return ApiResponse.notFound(event, error.code, { requestId: correlationId });

      case 409:
        return ApiResponse.conflict(event, error.code, { requestId: correlationId });

      case 422:
        return ApiResponse.unprocessable(event, error.code, { requestId: correlationId });

      default:
        return ApiResponse.internalError(event, error.code, { requestId: correlationId });
    }
  }

  return ApiResponse.internalError(event, "INTERNAL_ERROR", { requestId: correlationId });
}