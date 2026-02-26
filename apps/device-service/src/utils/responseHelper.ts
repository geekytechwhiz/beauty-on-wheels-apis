import type { APIGatewayProxyResult } from 'aws-lambda';
import { logHttpRequest } from '@api-hub/logger';
import type { Logger } from '@api-hub/logger';

export interface LogAndRespondOptions {
  logger: Logger;
  method: string;
  path: string;
  statusCode: number;
  startTime: number;
  correlationId: string;
}

/**
 * Logs the HTTP request (duration, status) and returns the response.
 * Use before every successful or error return to avoid repeating duration + logHttpRequest.
 *
 * @param options - Logger, method, path, statusCode, startTime, correlationId
 * @param response - The ApiResponse result to return
 * @returns The same response (pass-through)
 */
export function logAndRespond(
  options: LogAndRespondOptions,
  response: APIGatewayProxyResult,
): APIGatewayProxyResult {
  const { logger, method, path, statusCode, startTime, correlationId } = options;
  const duration = Date.now() - startTime;
  logHttpRequest(logger, method, path, statusCode, duration, correlationId);
  return response;
}
