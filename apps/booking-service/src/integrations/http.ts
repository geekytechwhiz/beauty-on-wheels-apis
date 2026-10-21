import { BookingError } from '../errors';

export async function requestJson(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    console.log('requestJson_url', url);
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      'Downstream service could not be reached',
      502,
      undefined,
      true,
    );
  }

  const text = await response.text();
  let parsed: unknown = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new BookingError(
        'DEPENDENCY_UNAVAILABLE',
        'Downstream service returned an unreadable response',
        502,
      );
    }
  }

  if (!response.ok) {
    throw mapHttpFailure(response.status, parsed);
  }
  return unwrapData(parsed);
}

export function unwrapData(parsed: unknown): unknown {
  if (parsed && typeof parsed === 'object' && 'data' in parsed) {
    return (parsed as { data: unknown }).data;
  }
  return parsed;
}

export function mapHttpFailure(status: number, parsed: unknown): BookingError {
  const code = readCode(parsed);
  const message = readMessage(parsed) || 'Downstream service rejected the request';
  if (code === 'VENDOR_PRICING_UNAVAILABLE' || code === 'CATALOG_PRICING_UNAVAILABLE') {
    return new BookingError(
      'CATALOG_PRICING_UNAVAILABLE',
      'Service Catalog could not resolve the vendor price',
      502,
      undefined,
      true,
    );
  }
  if (status === 404) {
    return new BookingError(code || 'NOT_FOUND', message, 404);
  }
  if (status === 403) {
    return new BookingError(code || 'FORBIDDEN', message, 403, undefined, false);
  }
  if (status === 409) {
    return new BookingError(code || 'CONFLICT', message, 409, undefined, false);
  }
  if (status === 400 || status === 422) {
    return new BookingError(code || 'VALIDATION_ERROR', message, status, undefined, false);
  }
  return new BookingError(
    code || 'DEPENDENCY_UNAVAILABLE',
    message,
    status >= 500 ? 502 : status,
    undefined,
    status >= 500,
  );
}

function readCode(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const record = parsed as { error?: { code?: unknown }; code?: unknown };
  const code = record.error?.code ?? record.code;
  return typeof code === 'string' && code.trim() ? code : undefined;
}

function readMessage(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const record = parsed as {
    message?: { description?: unknown } | string;
    errorMessage?: unknown;
  };
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message;
  }
  if (
    record.message &&
    typeof record.message === 'object' &&
    typeof record.message.description === 'string'
  ) {
    return record.message.description;
  }
  if (typeof record.errorMessage === 'string') {
    return record.errorMessage;
  }
  return undefined;
}

export function authHeaders(authorizationHeader?: string): Record<string, string> | undefined {
  return authorizationHeader ? { Authorization: authorizationHeader } : undefined;
}

export function requireBaseUrl(value: string, name: string): string {
  const base = value.trim().replace(/\/$/, '');
  if (!base) {
    throw new BookingError(
      'DEPENDENCY_UNAVAILABLE',
      `${name} is not configured`,
      502,
      undefined,
      true,
    );
  }
  return base;
}
