import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId,   logHttpRequest, createChildLogger } from '@api-hub/logger';
 

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
export const main: APIGatewayProxyHandler = async (event, context?: Context) => {

    const startTime = Date.now();
    const correlationId = extractCorrelationId( {});
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const duration = Date.now() - startTime;
    
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    logHttpRequest(logger, event.httpMethod || 'GET', event.path || `/health`, 400, duration, correlationId);
  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'ok' }),
  };
};
