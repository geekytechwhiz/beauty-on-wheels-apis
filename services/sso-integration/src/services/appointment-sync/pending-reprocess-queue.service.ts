import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { PendingReprocessMessage } from '../../types/events/pending-reprocess-message.types';

export async function publishPendingReprocess(
  message: PendingReprocessMessage,
): Promise<void> {
  const queueUrl = process.env.PENDING_REPROCESS_QUEUE_URL;
  if (!queueUrl?.trim()) {
    throw new Error('PENDING_REPROCESS_QUEUE_URL is not set');
  }
  const client = new SQSClient({});
  await client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  );
}
