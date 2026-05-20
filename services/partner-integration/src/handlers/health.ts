import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { getRequestId, responseOpts, createHandlerLogger } from '../utils/handlerHelpers';
import { logHttpRequest } from '@api-hub/observability';
import { ApiResponse } from '@api-hub/utils';

export const main: any = async (event: any, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const logger = createHandlerLogger(event, context);
  logger.info({ event: 'health_check_received' });
  const duration = Date.now() - startTime;
  logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/health', 200, duration, requestId);
  return ApiResponse.ok(
    { status: 'ok', service: 'partner-integration' },
    'HEALTH.HEALTH_CHECK_OK',
    { correlationId: requestId, event }
  );
};
