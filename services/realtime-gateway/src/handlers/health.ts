import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  createChildLogger,
  logHttpRequest,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';

const baseLogger = createLogger({ service: 'realtime-gateway', redactPII: true });

function getRequestId(event: { headers?: Record<string, string> }, context?: Context): string {
  const id =
    event.headers?.['x-correlation-id'] ??
    event.headers?.['X-Correlation-Id'] ??
    (context && (context as { awsRequestId?: string }).awsRequestId);
  return id ?? 'unknown';
}

function responseOpts(event: { headers?: Record<string, string> }, requestId: string) {
  return { requestId, event };
}

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const logger = createChildLogger(baseLogger, {
    correlationId: requestId,
    ...(context && { awsRequestId: extractAwsRequestId(context) }),
  });
  logger.info({ event: 'health_check_received' });
  const duration = Date.now() - startTime;
  logHttpRequest(logger, event.httpMethod ?? 'GET', event.path ?? '/health', 200, duration, requestId);
  return ApiResponse.ok(
    { status: 'ok', service: 'realtime-gateway' },
    'HEALTH.HEALTH_CHECK_OK',
    responseOpts(event, requestId)
  );
};
