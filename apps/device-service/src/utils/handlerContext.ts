import type { APIGatewayProxyevent: any, Context } from 'aws-lambda';
import { createLogger, extractCorrelationId, extractAwsRequestId, createChildLogger } from '@api-hub/observability';
import type { Logger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'device-service', redactPII: true });

/**
 * Context available in every handler: timing, correlation, and logger.
 * Use createHandlerContext at the start of each handler for consistency.
 */
export interface HandlerContext {
  startTime: number;
  correlationId: string;
  awsRequestId: string | undefined;
  logger: Logger;
  event: APIGatewayProxyEvent;
}

/**
 * Creates shared handler context (logger with correlationId, awsRequestId, startTime).
 * Call once at the top of each Lambda handler.
 *
 * @param event - API Gateway event
 * @param context - Lambda context (optional)
 * @returns HandlerContext for the rest of the handler
 */
export function createHandlerContext(event: APIGatewayProxyevent: any, context?: Context): HandlerContext {
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
  return {
    startTime: Date.now(),
    correlationId,
    awsRequestId,
    logger,
    event: any,
  };
}

/** Re-export baseLogger for handlers that instantiate services at module level. */
export { baseLogger };
