import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/logger';
import { Context, SQSEvent } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import { UserProvisioningService } from '../../services/appointment-sync/user-provisioning.service';
import { getSSOUserServiceClient } from '../../clients/user-service.client';
import { buildSSORequestContextFromAppointmentMessage } from '../../utils/context-builder.util';
import { DoctorProvisionMessage } from '../../types/events/doctor-provision-message.types';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * Consumes DoctorProvisionQueue: creates doctor via UserProvisioningService,
 * then re-enqueues the appointment to AppointmentSyncQueue for full processing.
 */
export async function handler(
  event: SQSEvent,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    component: 'DoctorProvisionWorkerHandler',
    awsRequestId,
  });

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  const userServiceClient = getSSOUserServiceClient();
  const userProvisioningService = new UserProvisioningService(
    userServiceClient,
    logger,
  );

  for (const record of event.Records) {
    const recordId = record.messageId;

    try {
      const body = JSON.parse(record.body) as DoctorProvisionMessage;
      const { tenantId, correlationId, appointment } = body;
      if (!tenantId || !correlationId || !appointment) {
        throw new Error(
          'Message body must contain tenantId, correlationId, and appointment',
        );
      }

      const requestContext = buildSSORequestContextFromAppointmentMessage(
        tenantId,
        correlationId,
      );

      await userProvisioningService.getOrCreateDoctor(appointment, requestContext);

      const queueUrl = process.env.APPOINTMENT_SYNC_QUEUE_URL;
      if (!queueUrl) {
        throw new Error('APPOINTMENT_SYNC_QUEUE_URL is not set');
      }

      const sqsClient = new SQSClient({});
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            tenantId,
            appointment,
            correlationId,
          }),
        }),
      );

      logger.info({
        event: 'doctor_provision_worker_success',
        recordId,
        tenantId,
        correlationId,
        appointmentExternalId: appointment.appointmentId,
      });
    } catch (error) {
      logger.error({
        event: 'doctor_provision_worker_error',
        recordId,
        err: serializeError(error as Error),
      });
      batchItemFailures.push({ itemIdentifier: recordId });
    }
  }

  return { batchItemFailures };
}
