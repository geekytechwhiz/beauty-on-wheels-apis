import { ScheduledEvent } from 'aws-lambda';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';

import { getHmsAppointmentBatchSyncService } from '../../services/hms-appointment-batch-sync.service';
import { buildSchedulerContext } from '../../context/context-factory';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export async function handler(event: ScheduledEvent): Promise<void> {
  const correlationId =
    (event as unknown as { 'X-Correlation-Id'?: string })['X-Correlation-Id'] ||
    `hms-sync-${Date.now()}`;

  const logger = createChildLogger(baseLogger, {
    component: 'SyncHmsAppointmentsHandler',
    correlationId,
  });

  logger.info({
    event: 'lambda_invocation_start',
    handler: 'events/sync-hms-appointments',
    correlationId,
    detailType: (event as unknown as { 'detail-type'?: string })['detail-type'],
  });

  try {
    const today = new Date();
    const startDate = today.toISOString().slice(0, 10);

    const lookaheadDaysEnv = process.env.SYNC_LOOKAHEAD_DAYS;
    const lookaheadDays = Number.isFinite(Number(lookaheadDaysEnv))
      ? Math.max(0, Number(lookaheadDaysEnv))
      : 1;

    const end = new Date(today);
    end.setDate(end.getDate() + lookaheadDays);
    const endDate = end.toISOString().slice(0, 10);
    const context = await buildSchedulerContext(
      '4', // tenantId
      correlationId
    );
    const batchSyncService = getHmsAppointmentBatchSyncService();

    const summary = await batchSyncService.syncAllRegisteredDoctors(
      startDate,
      endDate,
      context,
    );

    logger.info({
      event: 'lambda_invocation_complete',
      handler: 'events/sync-hms-appointments',
      correlationId,
      summary,
    });
  } catch (error) {
    logger.error({
      event: 'lambda_invocation_error',
      handler: 'events/sync-hms-appointments',
      correlationId,
      err: serializeError(error as Error),
    });

    // Let the error bubble so EventBridge Scheduler can apply its retry policy
    throw error;
  }
}

