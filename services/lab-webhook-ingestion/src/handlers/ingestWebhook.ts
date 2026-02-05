import type { APIGatewayProxyHandler, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  createChildLogger,
} from '@api-hub/logger';
import { handleIngestWebhook, reportHttpLog } from '../httpHandler';

const baseLogger = createLogger({ service: 'lab-webhook-ingestion', redactPII: true });

function getRequestId(
  event: Parameters<typeof extractCorrelationId>[0],
  context?: Context
): string {
  return (
    extractCorrelationId(event) ??
    (context && extractAwsRequestId(context)) ??
    'unknown'
  );
}

export const main: APIGatewayProxyHandler = async (event, context?: Context) => {
  const startTime = Date.now();
  const requestId = getRequestId(event, context);
  const partnerId = event.pathParameters?.partnerId;
  const logger = createChildLogger(baseLogger, {
    correlationId: requestId,
    ...(context && { awsRequestId: extractAwsRequestId(context) }),
    ...(partnerId && { partnerId }),
  });

  logger.info({ event: 'ingest_webhook_received', partnerId });

  const result = await handleIngestWebhook(event, context ?? ({} as Context), logger);
  const duration = Date.now() - startTime;
  reportHttpLog(
    logger,
    event.httpMethod ?? 'POST',
    event.path ?? '/webhooks/labs/{partnerId}',
    result.statusCode,
    duration,
    requestId
  );
  return result;
};
