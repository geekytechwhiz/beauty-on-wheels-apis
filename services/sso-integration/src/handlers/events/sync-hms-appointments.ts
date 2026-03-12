import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScheduledEvent } from 'aws-lambda';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';

import { AppointmentSyncService } from '../../services/appointment-sync.service'; 
import { buildSSORequestContext } from '../../utils/context-builder.util';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
}); 
 

function isHttpEvent(event: unknown): event is APIGatewayProxyEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'requestContext' in event &&
    'httpMethod' in event
  );
}

 

export async function handler(
  event: ScheduledEvent | APIGatewayProxyEvent,
): Promise<void | APIGatewayProxyResult> {
  const isHttp = isHttpEvent(event);
  const correlationId = isHttp
    ? (event.requestContext?.requestId ?? event.headers?.['X-Correlation-Id'] ?? `hms-sync-${Date.now()}`)
    : (event as unknown as { 'X-Correlation-Id'?: string })['X-Correlation-Id'] ?? `hms-sync-${Date.now()}`;

  const logger = createChildLogger(baseLogger, {
    component: 'SyncHmsAppointmentsHandler',
    correlationId,
  });

  logger.info({
    event: 'lambda_invocation_start',
    handler: 'events/sync-hms-appointments',
    correlationId,
    source: isHttp ? 'http' : 'scheduler',
    detailType: isHttp ? undefined : (event as unknown as { 'detail-type'?: string })['detail-type'],
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
    const context = buildSSORequestContext(event as APIGatewayProxyEvent, correlationId)
    const appointmentSyncService = new AppointmentSyncService();

    const summary = await appointmentSyncService.syncAppointments(
      context,
    );

    logger.info({
      event: 'lambda_invocation_complete',
      handler: 'events/sync-hms-appointments',
      correlationId,
      summary,
    });

    if (isHttp) {
      return ApiResponse.ok(
        { summary },
        { title: 'Success', description: 'HMS appointment sync completed', severity: 'SUCCESS' },
        { requestId: correlationId, headers: { 'X-Correlation-Id': correlationId } },
      );
    }
  } catch (error) {
    logger.error({
      event: 'lambda_invocation_error',
      handler: 'events/sync-hms-appointments',
      correlationId,
      err: serializeError(error as Error),
    });

    if (isHttp) {
      return ApiResponse.internalServerError(
        { title: 'Error', description: 'HMS appointment sync failed', severity: 'ERROR' },
        { requestId: correlationId, headers: { 'X-Correlation-Id': correlationId } },
        { code: 'INTERNAL_ERROR' },
      );
    }

    // Let the error bubble so EventBridge Scheduler can apply its retry policy
    throw error;
  }
}

