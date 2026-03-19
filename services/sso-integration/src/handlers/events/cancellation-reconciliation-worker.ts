import {
  createChildLogger,
  createLogger,
  extractAwsRequestId,
  serializeError,
} from '@api-hub/logger';
import { Context, SQSEvent } from 'aws-lambda';

import { AppointmentSyncService } from '../../services/appointment-sync.service';
import { CancellationReconciliationMessage } from '../../types/events/cancellation-reconciliation-message.types';
import { buildSSORequestContextFromAppointmentMessage } from '../../utils/context-builder.util';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

export async function handler(
  event: SQSEvent,
  context?: Context,
): Promise<{ batchItemFailures: Array<{ itemIdentifier: string }> }> {
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;
  const logger = createChildLogger(baseLogger, {
    component: 'CancellationReconciliationWorkerHandler',
    awsRequestId,
  });

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  const appointmentSyncService = new AppointmentSyncService();

  for (const record of event.Records) {
    const recordId = record.messageId;
    try {
      const body = JSON.parse(record.body) as CancellationReconciliationMessage;
      if (
        !body.tenantId ||
        !body.correlationId ||
        !body.organizationId ||
        !body.fromDate ||
        !body.toDate ||
        !Array.isArray(body.appointments)
      ) {
        throw new Error(
          'Message body must contain tenantId, correlationId, organizationId, fromDate, toDate, appointments',
        );
      }

      const requestContext = buildSSORequestContextFromAppointmentMessage(
        body.tenantId,
        body.correlationId,
      );
      const result =
        await appointmentSyncService.reconcileMissingAppointmentsAsCancelledFromQueue(
          body,
          requestContext,
        );

      logger.info({
        event: 'reconciliation_worker_success',
        recordId,
        tenantId: body.tenantId,
        correlationId: body.correlationId,
        organizationId: body.organizationId,
        totalAppointments: body.appointments.length,
        cancelled: result.cancelled,
        failed: result.failed,
        skipped: result.skipped,
      });
    } catch (error) {
      logger.error({
        event: 'reconciliation_worker_error',
        recordId,
        err: serializeError(error as Error),
      });
      batchItemFailures.push({ itemIdentifier: recordId });
    }
  }

  return { batchItemFailures };
}

