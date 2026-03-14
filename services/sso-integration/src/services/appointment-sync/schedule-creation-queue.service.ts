import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ScheduleCreationMessage } from '../../types/events/schedule-creation-message.types';

/**
 * Publishes a schedule creation job to ScheduleCreationQueue.
 * Used when USE_SCHEDULE_CREATION_QUEUE is true (async schedule creation).
 */
export async function publishScheduleCreation(
  message: ScheduleCreationMessage,
): Promise<void> {
  const queueUrl = process.env.SCHEDULE_CREATION_QUEUE_URL;
  if (!queueUrl || queueUrl.trim() === '') {
    throw new Error('SCHEDULE_CREATION_QUEUE_URL is not set');
  }

  const client = new SQSClient({});
  await client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  );
}
