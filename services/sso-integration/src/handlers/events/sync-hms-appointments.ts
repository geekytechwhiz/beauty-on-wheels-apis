import { ScheduledEvent } from 'aws-lambda';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';

import { Appointment } from '../../types';
import { AppointmentSyncService } from '../../services/appointment-sync.service';
import { buildSSORequestContextFromTenant } from '../../utils/context-builder.util';
import { emitMetric, MetricNames } from '../../utils/metrics.util';
import { getEnvConfig } from '../../config/env';
import { getExternalTenantsByProvider } from '../../services/external-tenant.service';

const SQS_BATCH_SIZE = 10;

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

/**
 * Scheduled handler: fetch from HMS, validate, enqueue to AppointmentSyncQueue only.
 * Triggered by EventBridge Scheduler. No HTTP exposure. Never processes appointments inline.
 */
export async function handler(
  event: ScheduledEvent,
): Promise<void> {
  const correlationId =
    (event as unknown as { 'X-Correlation-Id'?: string })['X-Correlation-Id'] ??
    `hms-sync-${Date.now()}`;

  const logger = createChildLogger(baseLogger, {
    component: 'SyncHmsAppointmentsHandler',
    correlationId,
  });

  logger.info({
    event: 'lambda_invocation_start',
    handler: 'events/sync-hms-appointments',
    correlationId,
    source: 'scheduler',
    detailType: (event as unknown as { 'detail-type'?: string })['detail-type'],
  });

  try {
    const env = getEnvConfig();
    const tenants = await getExternalTenantsByProvider(env.PROVIDER);
    if (!tenants.length) {
      throw new Error(`No external tenants found for provider ${env.PROVIDER}`);
    }

    const appointmentSyncService = new AppointmentSyncService();

    const queueUrl = process.env.APPOINTMENT_SYNC_QUEUE_URL;
    if (!queueUrl) {
      throw new Error('APPOINTMENT_SYNC_QUEUE_URL is not set');
    }

    const sqsClient = new SQSClient({});
    let enqueued = 0;
    let totalAppointments = 0;

    for (const tenant of tenants) {
      const context = buildSSORequestContextFromTenant(tenant, correlationId);
      const validAppointments =
        await appointmentSyncService.fetchAndValidateAppointments(context);
      totalAppointments += validAppointments.length;

      for (let i = 0; i < validAppointments.length; i += SQS_BATCH_SIZE) {
        const chunk = validAppointments.slice(i, i + SQS_BATCH_SIZE);
        const entries = chunk.map((appointment: Appointment, idx: number) => ({
          Id: `${tenant.tenantId}-${i + idx}`,
          MessageBody: JSON.stringify({
            tenantId: context.tenantId,
            appointment,
            correlationId: context.correlationId,
          }),
        }));

        await sqsClient.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: entries,
          }),
        );
        enqueued += entries.length;
      }

      await emitMetric(MetricNames.HMS_FETCH_SUCCESS, 1, 'Count', {
        tenantId: context.tenantId,
      });
    }

    logger.info({
      event: 'lambda_invocation_complete',
      handler: 'events/sync-hms-appointments',
      correlationId,
      provider: env.PROVIDER,
      tenantCount: tenants.length,
      enqueued,
      totalAppointments,
    });
  } catch (error) {
    await emitMetric(MetricNames.HMS_FETCH_FAILURES, 1, 'Count', {
      tenantId: 'unknown',
    });
    logger.error({
      event: 'lambda_invocation_error',
      handler: 'events/sync-hms-appointments',
      correlationId,
      err: serializeError(error as Error),
    });
    throw error;
  }
}
