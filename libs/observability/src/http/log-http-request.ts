import { getLogger } from '../logger/logger';

function emit(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  correlationId?: string,
): void {
  const log = getLogger();
  const payload = {
    method,
    path,
    statusCode,
    duration: durationMs,
    correlationId,
  };
  if (statusCode >= 500) {
    log.error('http_request', undefined, payload);
  } else if (statusCode >= 400) {
    log.warn('http_request', payload);
  } else {
    log.info('http_request', payload);
  }
}

/**
 * Log HTTP request outcome using structured `http_request` events (Powertools via {@link getLogger}).
 *
 * Supports legacy 6-arg calls where the first `logger` argument is ignored (migration from `@api-hub/logger`).
 */
export function logHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  correlationId?: string,
): void;
export function logHttpRequest(
  _logger: unknown,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  correlationId?: string,
): void;
export function logHttpRequest(...args: unknown[]): void {
  if (
    args.length >= 4 &&
    typeof args[0] === 'string' &&
    typeof args[1] === 'string' &&
    typeof args[2] === 'number' &&
    typeof args[3] === 'number'
  ) {
    const method = args[0] as string;
    const path = args[1] as string;
    const statusCode = args[2] as number;
    const durationMs = args[3] as number;
    const correlationId =
      typeof args[4] === 'string' ? (args[4] as string) : undefined;
    emit(method, path, statusCode, durationMs, correlationId);
    return;
  }

  if (
    args.length >= 6 &&
    typeof args[1] === 'string' &&
    typeof args[2] === 'string' &&
    typeof args[3] === 'number' &&
    typeof args[4] === 'number'
  ) {
    const method = args[1] as string;
    const path = args[2] as string;
    const statusCode = args[3] as number;
    const durationMs = args[4] as number;
    const correlationId =
      typeof args[5] === 'string' ? (args[5] as string) : undefined;
    emit(method, path, statusCode, durationMs, correlationId);
    return;
  }

  throw new Error(
    'logHttpRequest: expected (method, path, statusCode, durationMs, correlationId?) or (logger, method, path, statusCode, durationMs, correlationId?)',
  );
}
