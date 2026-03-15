import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ScheduleCreationEventPayload } from '../../types/events/schedule-creation-message.types';

function assertValidScheduleCreationPayload(
  message: ScheduleCreationEventPayload,
): void {
  if (
    !message.tenantId ||
    !message.correlationId ||
    !message.appointment.externalId ||
    !message.appointment.startTime ||
    !message.appointment.endTime ||
    !message.appointment.status ||
    !message.doctor.userId ||
    !message.doctor.externalUserId ||
    !message.doctor.organizationId ||
    !message.patient.userId ||
    !message.patient.externalUserId ||
    !message.patient.organizationId
  ) {
    throw new Error('Schedule creation payload must be normalized before enqueue');
  }
}

/**
 * Publishes a schedule creation job to ScheduleCreationQueue.
 * Used when USE_SCHEDULE_CREATION_QUEUE is true (async schedule creation).
 */
export async function publishScheduleCreation(
  message: ScheduleCreationEventPayload,
): Promise<void> {
  const queueUrl = process.env.SCHEDULE_CREATION_QUEUE_URL;
  if (!queueUrl || queueUrl.trim() === '') {
    throw new Error('SCHEDULE_CREATION_QUEUE_URL is not set');
  }

  assertValidScheduleCreationPayload(message);

  const client = new SQSClient({});
  await client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  );
}
