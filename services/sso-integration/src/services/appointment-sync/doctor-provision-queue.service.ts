import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { DoctorProvisionMessage } from '../../types/events/doctor-provision-message.types';

export async function publishDoctorProvision(
  message: DoctorProvisionMessage,
): Promise<void> {
  const queueUrl = process.env.DOCTOR_PROVISION_QUEUE_URL;
  if (!queueUrl?.trim()) {
    throw new Error('DOCTOR_PROVISION_QUEUE_URL is not set');
  }
  const client = new SQSClient({});
  await client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  );
}
