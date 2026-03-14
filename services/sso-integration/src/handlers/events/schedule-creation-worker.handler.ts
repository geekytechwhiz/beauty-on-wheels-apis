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
import { AppointmentIdempotencyService } from '../../services/appointment-sync/appointment-idempotency.service';
import { ScheduleCreationService } from '../../services/appointment-sync/schedule-creation.service';
import {
  getScheduleIdempotency,
  setScheduleIdempotency,
} from '../../services/appointment-sync/schedule-idempotency-store';
import type { ScheduleCreationMessage } from '../../types/events/schedule-creation-message.types';
import { buildSSORequestContextFromAppointmentMessage } from '../../utils/context-builder.util';
import { emitMetric, MetricNames } from '../../utils/metrics.util';
import { CognitoUserContext } from '../../types/user/user.types';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * SQS handler for ScheduleCreationQueue.
 * Creates schedule via ScheduleCreationService with idempotency by appointmentExternalId.
 * Failed messages are reported as batch item failures for SQS retry.
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
  const appointmentIdempotencyService = new AppointmentIdempotencyService(
    scheduleClient,
    logger,
  );
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

      const existingIdempotency = await getScheduleIdempotency(
        tenantId,
        appointmentExternalId,
      );
      if (existingIdempotency) {
        logger.info({
          event: 'schedule_creation_worker_idempotency_skip',
          recordId,
          tenantId,
          appointmentExternalId,
          correlationId,
          scheduleId: existingIdempotency.scheduleId,
        });
        continue;
      }

      const doctorAsCognito: CognitoUserContext = {
        principalId: doctor.userId,
        userId: doctor.userId,
        organizationId: doctor.organizationId,
        userType: 'STAFF',
        tenantSubdomain: tenantId,
        roles: [],
        permissions: [],
      };

      const isDuplicate = await appointmentIdempotencyService.checkDuplicateSchedule(
        appointment,
        doctorAsCognito,
        patientUser,
        requestContext,
      );

      if (isDuplicate) {
        logger.info({
          event: 'schedule_creation_worker_duplicate_skipped',
          recordId,
          appointmentExternalId,
          correlationId,
        });
        continue;
      }

      const schedule = await scheduleCreationService.createServiceScheduleWithRetry(
        appointment,
        doctor,
        patientUser,
        requestContext,
      );

      await setScheduleIdempotency(
        tenantId,
        appointmentExternalId,
        schedule.scheduleId,
      );

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
