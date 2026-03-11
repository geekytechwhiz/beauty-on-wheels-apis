import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ScheduledEvent } from 'aws-lambda';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';

import { getAppointmentSyncService } from '../../services/appointment-sync.service';
import { getServiceTokenService } from '../../services/service-token.service';
import { buildSchedulerContext } from '../../context/context-factory';

const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});

const BEARER_PREFIX = /^Bearer\s+/i;

/** Literal token accepted for internal/scheduler callers (e.g. API Gateway calling this endpoint). */
const SERVICE_TOKEN_LITERAL = 'service-token';

function isHttpEvent(event: unknown): event is APIGatewayProxyEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    'requestContext' in event &&
    'httpMethod' in event
  );
}

/** When invoked via HTTP, require Authorization. Accepts Bearer "service-token" (literal) or a JWT signed with SERVICE_TOKEN_SECRET. */
function verifyServiceTokenForHttp(
  event: APIGatewayProxyEvent,
  logger: ReturnType<typeof createChildLogger>,
): APIGatewayProxyResult | null {
  const authHeader =
    (event.headers?.Authorization as string | undefined) ||
    (event.headers?.authorization as string | undefined);

  if (!authHeader || !BEARER_PREFIX.test(authHeader)) {
    logger.warn({ event: 'sync_hms_service_token_missing' });
    return ApiResponse.unauthorized(
      { title: 'Unauthorized', description: 'Missing or invalid Authorization header; use Bearer <service-token>', severity: 'ERROR' },
      { requestId: event.requestContext?.requestId ?? 'unknown', headers: { 'X-Correlation-Id': event.requestContext?.requestId ?? 'unknown' } },
      { code: 'UNAUTHORIZED' },
    );
  }

  const token = authHeader.replace(BEARER_PREFIX, '').trim();
  if (!token) {
    logger.warn({ event: 'sync_hms_service_token_empty' });
    return ApiResponse.unauthorized(
      { title: 'Unauthorized', description: 'Missing service token', severity: 'ERROR' },
      { requestId: event.requestContext?.requestId ?? 'unknown', headers: {} },
      { code: 'UNAUTHORIZED' },
    );
  }

  // Accept literal "service-token" for internal/scheduler callers (e.g. API Gateway → this endpoint)
  if (token === SERVICE_TOKEN_LITERAL) {
    return null;
  }

  try {
    getServiceTokenService().verifyToken(token);
    return null;
  } catch {
    logger.warn({ event: 'sync_hms_service_token_invalid' });
    return ApiResponse.unauthorized(
      { title: 'Unauthorized', description: 'Invalid or expired service token', severity: 'ERROR' },
      { requestId: event.requestContext?.requestId ?? 'unknown', headers: {} },
      { code: 'UNAUTHORIZED' },
    );
  }
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

  if (isHttp) {
    const authError = verifyServiceTokenForHttp(event, logger);
    if (authError) return authError;
  }

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
    const appointmentSyncService = getAppointmentSyncService();

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

