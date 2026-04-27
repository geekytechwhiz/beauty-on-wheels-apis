import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/logger';
import { Context, SQSEvent } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { getScheduleServiceClient } from '../../clients/schedule-service.client';
import { PendingReprocessMessage } from '../../types/events/pending-reprocess-message.types';
import { buildSSORequestContextFromAppointmentMessage } from '../../utils/context-builder.util';
import { getEnvConfig } from '../../config/env';
import { getExternalTenantsByProvider } from '../../services/external-tenant.service';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * Consumes PendingAppointmentReprocessQueue: loads pending appointments for the patient
 * via Scheduler service API, then re-enqueues each to AppointmentSyncQueue for processing.
 */
export async function handler(
  event: SQSEvent,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    component: 'PendingAppointmentReprocessWorkerHandler',
    awsRequestId,
  });

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  const env = getEnvConfig();
  await getExternalTenantsByProvider(env.PROVIDER);

  if (process.env.BYPASS_PENDING_APPOINTMENT === 'true') {
    for (const record of event.Records) {
      try {
        const body = JSON.parse(record.body) as PendingReprocessMessage;
        const { tenantId, patientExternalId, correlationId } = body;
        logger.info({
          event: 'pending_appointment_reprocess_bypassed',
          message: 'Pending appointment reprocessing bypassed',
          tenantId: tenantId ?? 'unknown',
          patientExternalId: patientExternalId ?? 'unknown',
          correlationId: correlationId ?? undefined,
        });
      } catch {
        logger.info({
          event: 'pending_appointment_reprocess_bypassed',
          message: 'Pending appointment reprocessing bypassed',
        });
      }
    }
    return { batchItemFailures };
  }

  const scheduleClient = getScheduleServiceClient();
  const queueUrl = process.env.APPOINTMENT_SYNC_QUEUE_URL;
  if (!queueUrl) {
    logger.error({ event: 'pending_reprocess_missing_queue_url' });
    for (const record of event.Records) {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
    return { batchItemFailures };
  }

  const sqsClient = new SQSClient({});

  for (const record of event.Records) {
    const recordId = record.messageId;

    try {
      const body = JSON.parse(record.body) as PendingReprocessMessage;
      const { tenantId, patientExternalId, correlationId } = body;
      if (!tenantId || !patientExternalId || !correlationId) {
        throw new Error(
          'Message body must contain tenantId, patientExternalId, and correlationId',
        );
      }

      const requestContext = buildSSORequestContextFromAppointmentMessage(
        tenantId,
        correlationId,
      );
      const pendingList = await scheduleClient.getPendingAppointmentsByPatient(
        tenantId,
        patientExternalId,
        requestContext,
      );

      for (const pending of pendingList) {
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
              tenantId,
              appointment: pending.appointment,
              correlationId,
            }),
          }),
        );
      }

      logger.info({
        event: 'pending_reprocess_worker_success',
        recordId,
        tenantId,
        patientExternalId,
        correlationId,
        reEnqueuedCount: pendingList.length,
      });
    } catch (error) {
      logger.error({
        event: 'pending_reprocess_worker_error',
        recordId,
        err: serializeError(error as Error),
      });
      batchItemFailures.push({ itemIdentifier: recordId });
    }
  }

  return { batchItemFailures };
}
