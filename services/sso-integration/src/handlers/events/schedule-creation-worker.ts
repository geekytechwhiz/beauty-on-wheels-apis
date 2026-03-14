import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/logger';

import { Context, SQSEvent } from 'aws-lambda';

import { getEnvConfig } from '../../config/env';
import { getScheduleServiceClient } from '../../clients/schedule-service.client';
import { getAppointmentMapper } from '../../mappers/appointment.mapper';
import { ScheduleCreationService } from '../../services/appointment-sync/schedule-creation.service';
import type { ScheduleCreationMessage } from '../../types/events/schedule-creation-message.types';
import { buildSSORequestContextFromAppointmentMessage } from '../../utils/context-builder.util';
import { emitMetric, MetricNames } from '../../utils/metrics.util';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * SQS handler for ScheduleCreationQueue.
 * Creates schedule via ScheduleCreationService. Idempotency is enforced by the
 * Scheduler Service using idempotencyKey = `${tenantId}#${appointmentExternalId}`.
 */
export async function handler(
  event: SQSEvent,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    component: 'ScheduleCreationWorkerHandler',
    awsRequestId,
  });

  logger.info({
    event: 'schedule_creation_worker_start',
    recordCount: event.Records.length,
  });

  const scheduleClient = getScheduleServiceClient();
  const appointmentMapper = getAppointmentMapper();
  const env = getEnvConfig();
  const scheduleCreationService = new ScheduleCreationService(
    scheduleClient,
    appointmentMapper,
    logger,
    {
      maxRetries: env.APPOINTMENT_SYNC_MAX_RETRIES,
      initialDelayMs: env.APPOINTMENT_SYNC_RETRY_DELAY_MS,
      maxDelayMs: env.APPOINTMENT_SYNC_MAX_RETRY_DELAY_MS,
    },
  );

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    const recordId = record.messageId;
    let body: ScheduleCreationMessage | undefined;

    try {
      body = JSON.parse(record.body) as ScheduleCreationMessage;

      const {
        tenantId,
        correlationId,
        appointmentExternalId,
        appointment,
        doctor,
        patientUser,
      } = body;

      if (
        !tenantId ||
        !correlationId ||
        !appointmentExternalId ||
        !appointment ||
        !doctor ||
        !patientUser
      ) {
        throw new Error(
          'Message body must contain tenantId, correlationId, appointmentExternalId, appointment, doctor, patientUser',
        );
      }

      const requestContext = buildSSORequestContextFromAppointmentMessage(
        tenantId,
        correlationId,
      );

      const schedule = await scheduleCreationService.createServiceScheduleWithRetry(
        appointment,
        doctor,
        patientUser,
        requestContext,
      );

      const patientExternalId = String(appointment.patient?.id ?? '');
      if (patientExternalId) {
        if (process.env.BYPASS_PENDING_APPOINTMENT === 'true') {
          logger.info({
            event: 'pending_appointment_remove_bypassed',
            message: 'BYPASS_PENDING_APPOINTMENT enabled — skipping pending remove',
            recordId,
            tenantId,
            appointmentExternalId,
            patientExternalId,
            correlationId: requestContext.correlationId,
          });
        } else {
          try {
            await scheduleClient.removePendingAppointment(
              tenantId,
              patientExternalId,
              appointmentExternalId,
              requestContext,
            );
          } catch (removeErr) {
            logger.warn({
              event: 'schedule_creation_worker_remove_pending_failed',
              recordId,
              tenantId,
              appointmentExternalId,
              err: serializeError(removeErr as Error),
            });
          }
        }
      }

      await emitMetric(MetricNames.SCHEDULE_CREATION_SUCCESS, 1, 'Count', {
        tenantId,
        appointmentExternalId,
      });
      logger.info({
        event: 'schedule_creation_worker_success',
        recordId,
        tenantId,
        appointmentExternalId,
        correlationId,
        scheduleId: schedule.scheduleId,
      });
    } catch (error) {
      await emitMetric(MetricNames.SCHEDULE_CREATION_FAILURES, 1, 'Count', {
        tenantId: body?.tenantId ?? 'unknown',
        appointmentExternalId: body?.appointmentExternalId ?? 'unknown',
      });
      logger.error({
        event: 'schedule_creation_worker_error',
        recordId,
        tenantId: body?.tenantId,
        appointmentExternalId: body?.appointmentExternalId,
        correlationId: body?.correlationId,
        err: serializeError(error as Error),
      });
      batchItemFailures.push({ itemIdentifier: recordId });
    }
  }

  logger.info({
    event: 'schedule_creation_worker_complete',
    totalRecords: event.Records.length,
    failures: batchItemFailures.length,
  });

  return { batchItemFailures };
}
