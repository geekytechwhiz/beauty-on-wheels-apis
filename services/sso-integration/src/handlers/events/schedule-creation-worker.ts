import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/observability';

import { Context, SQSEvent } from 'aws-lambda';

import { getEnvConfig } from '../../config/env';
import { getScheduleServiceClient } from '../../clients/schedule-service.client';
import { getAppointmentMapper } from '../../mappers/appointment.mapper';
import { ScheduleCreationService } from '../../services/appointment-sync/schedule-creation.service';
import type {
  ScheduleCreationEventPayload,
  ScheduleCreationQueueMessage,
} from '../../types/events/schedule-creation-message.types';
import { buildSSORequestContextFromAppointmentMessage } from '../../utils/context-builder.util';
import { emitMetric, MetricNames } from '../../utils/metrics.util';
import { normalizeScheduleEventPayload } from '../../utils/normalize-schedule-event-payload.util';
import { getExternalTenantsByProvider } from '../../services/external-tenant.service';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * SQS handler for ScheduleCreationQueue.
 * Creates schedule via ScheduleCreationService. Idempotency is enforced by the
 * Scheduler Service using idempotencyKey = `${tenantId}#${event.appointment.externalId}`.
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

  //Log the event
  logger.info({
    event: 'schedule_creation_worker_event',
    payload: JSON.stringify(event, null, 2),
  });

  const scheduleClient = getScheduleServiceClient();
  const appointmentMapper = getAppointmentMapper();
  const env = getEnvConfig();
  await getExternalTenantsByProvider(env.PROVIDER);
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
    let body: ScheduleCreationEventPayload | undefined;

    try {
      const rawBody = JSON.parse(record.body) as ScheduleCreationQueueMessage;
      body = normalizeScheduleEventPayload(rawBody);
      //Log the body
      logger.info({
        event: 'schedule_creation_worker_body',
        payload: JSON.stringify(body, null, 2),
      });
      const {
        tenantId,
        correlationId,
        appointment,
        doctor,
        patient,
      } = body;

      if (
        !tenantId ||
        !correlationId ||
        !appointment?.externalId ||
        !appointment.startTime ||
        !appointment.endTime ||
        !appointment.status ||
        !doctor?.userId ||
        !doctor.externalUserId ||
        !doctor.organizationId ||
        !patient?.userId ||
        !patient.externalUserId ||
        !patient.organizationId
      ) {
        throw new Error(
          'Message body must contain a normalized schedule creation payload',
        );
      }

      const requestContext = buildSSORequestContextFromAppointmentMessage(
        tenantId,
        correlationId,
      );

      const schedule = await scheduleCreationService.createServiceScheduleWithRetry(
        body,
        requestContext,
      );
      logger.info({
        event: 'schedule_creation_worker_success_response',
        response: JSON.stringify(schedule, null, 2),
      });

      const appointmentExternalId = appointment.externalId;
      const patientExternalId = patient.externalUserId;
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
        appointmentExternalId: body?.appointment?.externalId ?? 'unknown',
      });
      logger.error({
        event: 'schedule_creation_worker_error',
        recordId,
        tenantId: body?.tenantId,
        appointmentExternalId: body?.appointment?.externalId,
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
