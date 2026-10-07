import { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { createChildLogger, createLogger } from '@api-hub/observability';
import { WebhookRuntime } from './webhook-http';
import { InboundEnvelope } from '../types/whatsapp';

const logger = createChildLogger(createLogger({ service: 'whatsapp-channel-service', redactPII: true }), {
  component: 'inbound-batch',
});

export async function acceptInboundBatch(event: SQSEvent, runtime: WebhookRuntime): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
  const records = event.Records;

  await Promise.all(records.map(async (record) => {
    try {
      const envelope = JSON.parse(record.body) as InboundEnvelope;
      await runtime.processWebhook(envelope.payload, envelope.correlationId || record.messageId);
    } catch (error) {
      logger.error({ event: 'inbound_message_failed', messageId: record.messageId, err: error });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }));

  return { batchItemFailures };
}
