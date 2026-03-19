import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { CancellationReconciliationMessage } from '../../types/events/cancellation-reconciliation-message.types';

function assertValidPayload(message: CancellationReconciliationMessage): void {
  const missingFields = [
    !message.tenantId ? 'tenantId' : null,
    !message.correlationId ? 'correlationId' : null,
    !message.organizationId ? 'organizationId' : null,
    !message.fromDate ? 'fromDate' : null,
    !message.toDate ? 'toDate' : null,
    !Array.isArray(message.appointments) ? 'appointments' : null,
  ].filter(Boolean);

  if (missingFields.length > 0) {
    throw new Error(
      `Cancellation reconciliation payload missing: ${missingFields.join(', ')}`,
    );
  }
}

export async function publishCancellationReconciliation(
  message: CancellationReconciliationMessage,
): Promise<void> {
  const queueUrl = process.env.CANCELLATION_RECONCILIATION_QUEUE_URL;
  if (!queueUrl?.trim()) {
    throw new Error('CANCELLATION_RECONCILIATION_QUEUE_URL is not set');
  }

  assertValidPayload(message);

  const sqs = new SQSClient({});
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  );
}

