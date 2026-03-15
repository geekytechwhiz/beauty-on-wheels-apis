import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { ScheduleCreationEventPayload } from '../../types/events/schedule-creation-message.types';

function assertValidScheduleCreationPayload(
  message: ScheduleCreationEventPayload,
): void {
  const missingFields = [
    !message.tenantId ? 'tenantId' : null,
    !message.correlationId ? 'correlationId' : null,
    !message.appointment.externalId ? 'appointment.externalId' : null,
    !message.appointment.startTime ? 'appointment.startTime' : null,
    !message.appointment.endTime ? 'appointment.endTime' : null,
    !message.appointment.status ? 'appointment.status' : null,
    !message.doctor.userId ? 'doctor.userId' : null,
    !message.doctor.externalUserId ? 'doctor.externalUserId' : null,
    !message.doctor.organizationId ? 'doctor.organizationId' : null,
    !message.patient.userId ? 'patient.userId' : null,
    !message.patient.externalUserId ? 'patient.externalUserId' : null,
    !message.patient.organizationId ? 'patient.organizationId' : null,
  ].filter(Boolean);

  if (missingFields.length > 0) {
    throw new Error(
      `Schedule creation payload must be normalized before enqueue. Missing: ${missingFields.join(', ')}`,
    );
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
