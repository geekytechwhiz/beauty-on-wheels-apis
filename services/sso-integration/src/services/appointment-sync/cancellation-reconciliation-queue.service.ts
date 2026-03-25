import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { CancellationReconciliationMessage } from '../../types/events/cancellation-reconciliation-message.types';
import {
  hasNonEmptyTrimmed,
  isValidReconciliationDateField,
} from '../../utils/cancellation-reconciliation-validation.util';

const sqsClient = new SQSClient({});

function assertValidPayload(message: CancellationReconciliationMessage): void {
  const missingFields: string[] = [];

  if (!hasNonEmptyTrimmed(message.tenantId)) missingFields.push('tenantId');
  if (!hasNonEmptyTrimmed(message.correlationId)) missingFields.push('correlationId');
  if (!hasNonEmptyTrimmed(message.organizationId)) missingFields.push('organizationId');
  if (!isValidReconciliationDateField(message.fromDate)) missingFields.push('fromDate');
  if (!isValidReconciliationDateField(message.toDate)) missingFields.push('toDate');
  if (!Array.isArray(message.appointments)) missingFields.push('appointments');
  if (
    Array.isArray(message.appointments) &&
    message.appointments.some((a) => !hasNonEmptyTrimmed(a.externalAppointmentId))
  ) {
    missingFields.push('appointments[].externalAppointmentId');
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Cancellation reconciliation payload invalid or missing: ${missingFields.join(', ')}`,
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

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  );
}
