import { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { getWebhookRuntime } from '../composition';
import { acceptInboundBatch } from '../services/inbound-batch';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  return acceptInboundBatch(event, await getWebhookRuntime());
}
