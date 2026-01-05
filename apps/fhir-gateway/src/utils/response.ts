/**
 * Response Utilities
 * Reused from user-service pattern
 */

type JsonVal = string | number | boolean | null | JsonVal[] | { [k: string]: JsonVal };

export interface SuccessResponse<T = unknown> {
  data: T | null;
  meta?: Record<string, JsonVal>;
  links?: Record<string, string>;
  requestId?: string;
  message?: string;
}

export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  correlationId?: string;
  errors?: Array<{ field?: string; message: string }>;
}

export function problem(details: ProblemDetails) {
  const body = {
    type: details.type || 'about:blank',
    title: details.title,
    status: details.status,
    ...(details.detail && { detail: details.detail }),
    ...(details.instance && { instance: details.instance }),
    ...(details.code && { code: details.code }),
    ...(details.correlationId && { correlationId: details.correlationId }),
    ...(details.errors && { errors: details.errors }),
  };
  return {
    statusCode: details.status,
    headers: {
      'Content-Type': 'application/problem+json',
    },
    body: JSON.stringify(body),
  };
}

