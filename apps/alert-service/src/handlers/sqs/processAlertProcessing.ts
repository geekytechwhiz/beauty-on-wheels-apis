import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Context, SQSEvent } from 'aws-lambda';
import { ZodError } from 'zod';
import { createChildLogger, createLogger, extractAwsRequestId, serializeError } from '@api-hub/logger';
import { getAlertService } from '../../services/alert-app.service';
import { createAlertBodySchema } from '../../validators/alert.schemas';

const baseLogger = createLogger({ service: 'alert-service', redactPII: true });

const svc = getAlertService();

function receiveCount(record: SQSEvent['Records'][number]): number {
  const raw = record.attributes?.ApproximateReceiveCount;
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function shouldForwardToProcessingDlq(error: unknown, count: number): boolean {
  const threshold = Number(process.env.ALERT_FORWARD_TO_PROCESSING_DLQ_AFTER_RECEIVES ?? '5');
  if (count >= threshold) return true;
  if (error instanceof ZodError) return true;
  if (error instanceof SyntaxError) return true;
  return false;
}

/**
 * Ingest queue: validate payload and run the same idempotent create path as HTTP POST /alerts.
 *
 * - Transient failures: reported via `ReportBatchItemFailures` for SQS retry on the **ingest** queue.
 * - Exhausted receives or validation errors: message copied to **Processing DLQ** (`ALERT_PROCESSING_DLQ_URL`);
 *   intake copy is then removed. Use `replayProcessingFromDlq` to push back to ingest.
 */
export async function main(
  event: SQSEvent,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const logger = createChildLogger(baseLogger, {
    component: 'processAlertProcessing',
    awsRequestId: context ? extractAwsRequestId(context) : undefined,
  });

  const dlqUrl = process.env.ALERT_PROCESSING_DLQ_URL?.trim();
  const sqsClient = dlqUrl ? new SQSClient({ region: process.env.REGION }) : null;
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    const recordId = record.messageId;
    const count = receiveCount(record);
    try {
      const body = record.body;
      const raw = body ? (JSON.parse(body) as unknown) : {};
      const input = createAlertBodySchema.parse(raw);
      const { record: created, duplicate } = await svc.createAlert(input, undefined);
      logger.info({
        event: 'alert_processing_ok',
        recordId,
        alertId: created.alertId,
        duplicate,
        inputEventId: input.inputEventId,
      });
    } catch (error) {
      logger.error({
        event: 'alert_processing_failed',
        recordId,
        approximateReceiveCount: count,
        err: serializeError(error as Error),
      });

      if (!dlqUrl || !sqsClient) {
        batchItemFailures.push({ itemIdentifier: recordId });
        continue;
      }

      if (!shouldForwardToProcessingDlq(error, count)) {
        batchItemFailures.push({ itemIdentifier: recordId });
        continue;
      }

      try {
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: dlqUrl,
            MessageBody: record.body,
          }),
        );
        logger.info({
          event: 'alert_sent_to_processing_dlq',
          recordId,
          approximateReceiveCount: count,
        });
      } catch (sendErr) {
        logger.error({
          event: 'alert_processing_dlq_send_failed',
          recordId,
          err: serializeError(sendErr as Error),
        });
        batchItemFailures.push({ itemIdentifier: recordId });
      }
    }
  }

  return { batchItemFailures };
}
