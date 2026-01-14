import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, logHttpRequest, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });

  logger.info({ event: 'health_check_received' });

  const duration = Date.now() - startTime;
  logHttpRequest(logger, event.httpMethod || 'GET', event.path || '/health', 200, duration, correlationId);

  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'ok' }),
  };
};
