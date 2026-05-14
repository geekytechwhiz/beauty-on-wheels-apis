/**
 * Maps `AlertService` / upstream client failures to {@link BaseError} so
 * {@link handleError} (`@api-hub/utils`) can build responses, matching the
 * user-service pattern (`withLambdaHandler` catch → `handleError`).
 */
 
import { BaseError } from '@api-hub/utils'; 
  

export interface NormalizeAlertServiceErrorLog {
  logger?: any;
  correlationId?: string;
  organizationId?: string;
  logEvent?: string;
}

/**
 * All paths throw. Call from `handleCreateAlert` `catch` so the HTTP handler can
 * `return handleError(e, { correlationId, logger, event })`.
 */
export function normalizeAlertServiceError(error: unknown, log: NormalizeAlertServiceErrorLog): never {
  const err = error as Error & { statusCode?: number; code?: string };

  if (err.code === 'IDEMPOTENCY_KEY_IN_USE' && err.statusCode === 409) {
    throw new BaseError(err.message, 409, 'IDEMPOTENCY_KEY_IN_USE', [{ message: err.message }]);
  }

  const msg = err.message ?? 'Unexpected error';
  if (err.statusCode === 404 && msg.includes('Patient')) {
    throw new BaseError('Patient is not valid for this organization', 400, 'PATIENT_NOT_IN_ORG', [
      { message: msg },
    ]);
  }
  if (err.statusCode === 404 && msg.includes('Organization')) {
    throw new BaseError('Organization could not be found', 400, 'ORG_NOT_FOUND', [{ message: msg }]);
  }
  if (err.statusCode === 502) {
    throw new BaseError(msg, 502, 'UPSTREAM_ERROR', [{ message: msg }], {
      retryable: true,
    });
  }

  const logEvent = log.logEvent ?? 'alert_create_service_error';
  log.logger?.error({
    event: logEvent,
    correlationId: log.correlationId,
    ...(log.organizationId ? { organizationId: log.organizationId } : {}),
    err: err,
  });

  throw new BaseError('An unexpected error occurred', 500, 'INTERNAL_ERROR', [
    { message: 'An unexpected error occurred' },
  ]);
}
