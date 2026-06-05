import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/observability';
import { Context, SQSEvent } from 'aws-lambda';

import { AppointmentSyncService } from '../../services/appointment-sync.service';
import { CancellationReconciliationMessage } from '../../types/events/cancellation-reconciliation-message.types';
import { buildSSORequestContextFromAppointmentMessage } from '../../utils/context-builder.util';
import {
  hasNonEmptyTrimmed,
  isValidReconciliationDateField,
} from '../../utils/cancellation-reconciliation-validation.util';
import { getEnvConfig } from '../../config/env';
import { getExternalTenantsByProvider } from '../../services/external-tenant.service';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

let appointmentSyncServiceInstance: AppointmentSyncService | null = null;

function getAppointmentSyncService(): AppointmentSyncService {
  if (!appointmentSyncServiceInstance) {
    appointmentSyncServiceInstance = new AppointmentSyncService();
  }
  return appointmentSyncServiceInstance;
}

function validateMessageBody(body: CancellationReconciliationMessage): void {
  const appointmentsHaveExternalAppointmentId =
    Array.isArray(body.appointments) &&
    body.appointments.every((a) => hasNonEmptyTrimmed(a.externalAppointmentId));

  if (
    !hasNonEmptyTrimmed(body.tenantId) ||
    !hasNonEmptyTrimmed(body.correlationId) ||
    !hasNonEmptyTrimmed(body.organizationId) ||
    !isValidReconciliationDateField(body.fromDate) ||
    !isValidReconciliationDateField(body.toDate) ||
    !Array.isArray(body.appointments) ||
    !appointmentsHaveExternalAppointmentId
  ) {
    throw new Error(
      'Message body must contain non-empty tenantId, correlationId, organizationId, valid fromDate, valid toDate, and appointments with externalAppointmentId',
    );
  }
}

export async function handler(
  event: SQSEvent,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    component: 'CancellationReconciliationWorkerHandler',
    awsRequestId,
  });

  const appointmentSyncService = getAppointmentSyncService();
  const env = getEnvConfig();
  await getExternalTenantsByProvider(env.PROVIDER);

  logger.info({
    event: 'reconciliation_worker_batch_start',
    recordCount: event.Records.length,
  });

  const results = await Promise.allSettled(
    event.Records.map(async (record) => {
      const messageId = record.messageId;
      let correlationId: string | undefined;

      try {
        const body = JSON.parse(record.body) as CancellationReconciliationMessage;
        validateMessageBody(body);
        correlationId = body.correlationId.trim();

        const requestContext = buildSSORequestContextFromAppointmentMessage(
          body.tenantId.trim(),
          correlationId,
        );
        const result =
          await appointmentSyncService.reconcileMissingAppointmentsAsCancelledFromQueue(
            {
              ...body,
              tenantId: body.tenantId.trim(),
              correlationId,
              organizationId: body.organizationId.trim(),
            },
            requestContext,
          );

        logger.info({
          event: 'reconciliation_worker_success',
          messageId,
          correlationId,
          tenantId: body.tenantId,
          organizationId: body.organizationId,
          totalAppointments: body.appointments.length,
          cancelled: result.cancelled,
          failed: result.failed,
          skipped: result.skipped,
        });
      } catch (error) {
        logger.error({
          event: 'reconciliation_worker_error',
          messageId,
          correlationId: correlationId ?? 'unknown',
          err: serializeError(error as Error),
        });
        throw error;
      }
    }),
  );

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      batchItemFailures.push({
        itemIdentifier: event.Records[index].messageId,
      });
    }
  });

  logger.info({
    event: 'reconciliation_worker_batch_complete',
    totalRecords: event.Records.length,
    failures: batchItemFailures.length,
  });

  return { batchItemFailures };
}
