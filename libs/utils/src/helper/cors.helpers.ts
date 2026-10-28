/**
 * Browser origins allowed when CORS_ALLOWED_ORIGINS / ALLOWED_ORIGIN are unset.
 * Includes the Expo Web dev server at http://localhost:8081.
 */
export const DEFAULT_CORS_ALLOWED_ORIGINS = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:3000',
  'http://localhost:19006',
  'http://localhost:8080',
] as const;

export const DEFAULT_CORS_ALLOWED_ORIGINS_VALUE =
  DEFAULT_CORS_ALLOWED_ORIGINS.join(',');

export const CORS_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-Requested-With',
  'X-Amz-Date',
  'X-Api-Key',
  'X-Amz-Security-Token',
  'X-Amz-User-Agent',
  'X-Amzn-Trace-Id',
  'X-Correlation-Id',
  'X-Request-Id',
] as const;

export const CORS_ALLOW_METHODS = [
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
] as const;

export const CORS_PREFLIGHT_MAX_AGE_SECONDS = '600';

let activeCorsEvent: unknown;

export function configuredAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = (env.CORS_ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN ?? '').trim();
  if (!raw) {
    return [...DEFAULT_CORS_ALLOWED_ORIGINS];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function isHttpApiV2Event(event: unknown): boolean {
  return (
    !!event &&
    typeof event === 'object' &&
    (event as { version?: unknown }).version === '2.0'
  );
}

export function isHttpPreflight(event: unknown): boolean {
  if (!event || typeof event !== 'object') {
    return false;
  }
  const candidate = event as {
    httpMethod?: unknown;
    version?: unknown;
    requestContext?: { http?: { method?: unknown } };
  };
  const method =
    typeof candidate.httpMethod === 'string'
      ? candidate.httpMethod
      : typeof candidate.requestContext?.http?.method === 'string'
        ? candidate.requestContext.http.method
        : '';
  if (method.toUpperCase() !== 'OPTIONS') {
    return false;
  }
  return (
    typeof candidate.httpMethod === 'string' ||
    candidate.version === '2.0' ||
    candidate.requestContext?.http != null
  );
}

export function runWithCorsContext<T>(event: unknown, fn: () => T): T {
  const previous = activeCorsEvent;
  activeCorsEvent = event;
  const restore = () => {
    activeCorsEvent = previous;
  };
  try {
    const result = fn();
    if (
      result &&
      typeof result === 'object' &&
      typeof (result as { then?: unknown }).then === 'function'
    ) {
      return Promise.resolve(result).finally(restore) as T;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function currentCorsEvent(): unknown {
  return activeCorsEvent;
}

function headerValue(event: unknown, name: string): string | null {
  if (!event || typeof event !== 'object') {
    return null;
  }
  const record = event as {
    headers?: Record<string, string | undefined> | null;
    multiValueHeaders?: Record<string, Array<string | undefined> | undefined> | null;
  };
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(record.headers ?? {})) {
    if (key.toLowerCase() === target && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  for (const [key, value] of Object.entries(record.multiValueHeaders ?? {})) {
    const first = value?.[0];
    if (key.toLowerCase() === target && typeof first === 'string' && first.trim()) {
      return first.trim();
    }
  }
  return null;
}

export function resolveCorsOrigin(
  requestOrigin: string | null,
  allowedOrigins: readonly string[],
): { origin: string; credentials: boolean } | null {
  if (allowedOrigins.includes('*')) {
    if (requestOrigin) {
      return { origin: requestOrigin, credentials: true };
    }
    return { origin: '*', credentials: false };
  }
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return { origin: requestOrigin, credentials: true };
  }
  return null;
}

/**
 * CORS headers for REST (API Gateway v1) proxy responses.
 * Payload v2 HTTP APIs already append CORS at the gateway, so those responses
 * stay empty unless `force` is set for an OPTIONS invocation that reached Lambda.
 */
export function buildCorsHeaders(
  event?: unknown,
  options?: { force?: boolean },
): Record<string, string> {
  const source = event === undefined ? currentCorsEvent() : event;
  if (!options?.force && isHttpApiV2Event(source)) {
    return {};
  }
  const decision = resolveCorsOrigin(
    headerValue(source, 'origin'),
    configuredAllowedOrigins(),
  );
  if (!decision) {
    return {};
  }
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': decision.origin,
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS.join(','),
    'Access-Control-Allow-Methods': CORS_ALLOW_METHODS.join(','),
    Vary: 'Origin',
  };
  if (decision.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

export function corsPreflightResponse(event: unknown): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const headers = buildCorsHeaders(event, { force: isHttpApiV2Event(event) });
  if (headers['Access-Control-Allow-Origin']) {
    headers['Access-Control-Max-Age'] = CORS_PREFLIGHT_MAX_AGE_SECONDS;
  }
  return {
    statusCode: 204,
    headers,
    body: '',
  };
}
