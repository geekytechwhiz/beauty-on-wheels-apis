import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Context, SQSEvent } from 'aws-lambda';
import { createChildLogger, createLogger, extractAwsRequestId, serializeError } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'alert-service', redactPII: true });

/**
 * Re-drive **processing** DLQ messages back to the **ingest** queue (same payload as original intake).
 */
export async function main(
  event: SQSEvent,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const url = process.env.ALERT_INGEST_QUEUE_URL;
  if (!url?.trim()) {
    throw new Error('ALERT_INGEST_QUEUE_URL is not set');
  }

  const client = new SQSClient({ region: process.env.REGION });
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  const logger = createChildLogger(baseLogger, {
    component: 'replayProcessingFromDlq',
    awsRequestId: context ? extractAwsRequestId(context) : undefined,
  });

  for (const record of event.Records) {
    const recordId = record.messageId;
    try {
      await client.send(
        new SendMessageCommand({
          QueueUrl: url,
          MessageBody: record.body,
        }),
      );
      logger.info({ event: 'processing_dlq_replayed', recordId });
    } catch (error) {
      logger.error({
        event: 'processing_dlq_replay_failed',
        recordId,
        err: serializeError(error as Error),
      });
      batchItemFailures.push({ itemIdentifier: recordId });
    }
  }

  return { batchItemFailures };
}
