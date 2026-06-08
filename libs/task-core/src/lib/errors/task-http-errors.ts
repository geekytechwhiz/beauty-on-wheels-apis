import { BaseError } from '@api-hub/utils';

export interface NormalizeTaskServiceErrorLog {
  logger?: { error?: (payload: unknown) => void };
  correlationId?: string;
  organizationId?: string;
  logEvent?: string;
}

export function normalizeTaskServiceError(error: unknown, log: NormalizeTaskServiceErrorLog): never {
  const err = error as Error & { statusCode?: number; code?: string };

  if (err.code === 'IDEMPOTENCY_KEY_IN_USE' && err.statusCode === 409) {
    throw new BaseError(err.message, 409, 'IDEMPOTENCY_KEY_IN_USE', [{ message: err.message }]);
  }

  const logEvent = log.logEvent ?? 'task_monitoring_create_service_error';
  log.logger?.error?.({
    event: logEvent,
    correlationId: log.correlationId,
    ...(log.organizationId ? { organizationId: log.organizationId } : {}),
    err,
  });

  throw new BaseError('An unexpected error occurred', 500, 'INTERNAL_ERROR', [
    { message: 'An unexpected error occurred' },
  ]);
}
