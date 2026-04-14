import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/logger';

import { Context, SQSEvent } from 'aws-lambda';

import { AppointmentSyncService } from '../../services/appointment-sync.service';
import { buildSSORequestContextFromAppointmentMessage } from '../../utils/context-builder.util';
import { publishDoctorProvision } from '../../services/appointment-sync/doctor-provision-queue.service';
import { Appointment } from '../../types';
import { getEnvConfig } from '../../config/env';
import { getExternalTenantsByProvider } from '../../services/external-tenant.service';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export interface AppointmentSyncQueueMessage {
  tenantId: string;
  appointment: Appointment;
  correlationId: string;
}

/**
 * SQS handler for AppointmentSyncQueue.
 * Processes one appointment per message using existing AppointmentSyncService logic.
 * Failed messages are reported as batch item failures so SQS retries them.
 */
export async function handler(
  event: SQSEvent,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    component: 'AppointmentProcessorHandler',
    awsRequestId,
  });

  logger.info({
    event: 'appointment_processor_start',
    recordCount: event.Records.length,
  });

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  const appointmentSyncService = new AppointmentSyncService();
  const env = getEnvConfig();
  await getExternalTenantsByProvider(env.PROVIDER);

  for (const record of event.Records) {
    const recordId = record.messageId;

    try {
      const body = JSON.parse(record.body) as AppointmentSyncQueueMessage;

      const { tenantId, appointment, correlationId } = body;
      if (!tenantId || !appointment || !correlationId) {
        throw new Error(
          'Message body must contain tenantId, appointment, and correlationId',
        );
      }

      const requestContext = buildSSORequestContextFromAppointmentMessage(
        tenantId,
        correlationId,
      );

      const doctor = await appointmentSyncService.getDoctorIfExists(
        appointment,
        requestContext,
      );

      if (!doctor) {
        await publishDoctorProvision({
          tenantId,
          correlationId,
          appointment,
        });
        logger.info({
          event: 'appointment_processor_doctor_missing_enqueued',
          recordId,
          appointmentId: appointment.appointmentId,
          tenantId,
          correlationId,
        });
        continue;
      }

      await appointmentSyncService.processSingleAppointmentWithDoctor(
        appointment,
        doctor,
        requestContext,
      );

      logger.info({
        event: 'appointment_processor_record_success',
        recordId,
        appointmentId: appointment.appointmentId,
        tenantId,
        correlationId,
      });
    } catch (error) {
      logger.error({
        event: 'appointment_processor_record_error',
        recordId,
        err: serializeError(error as Error),
      });
      batchItemFailures.push({ itemIdentifier: recordId });
    }
  }

  logger.info({
    event: 'appointment_processor_complete',
    totalRecords: event.Records.length,
    failures: batchItemFailures.length,
  });

  return { batchItemFailures };
}
