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

const getCorsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Correlation-Id',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
});

export function ok<T>(
  data: T | null,
  options?: {
    meta?: SuccessResponse['meta'];
    links?: SuccessResponse['links'];
    requestId?: string;
    message?: string;
  },
) {
  const body: SuccessResponse<T> = {
    data,
    ...(options?.meta ? { meta: options.meta } : {}),
    ...(options?.links ? { links: options.links } : {}),
    ...(options?.requestId ? { requestId: options.requestId } : {}),
    ...(options?.message ? { message: options.message } : {}),
  };
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(),
    },
    body: JSON.stringify(body),
  };
}

export function created<T>(data: T | null, options?: { requestId?: string; message?: string }) {
  const body: SuccessResponse<T> = {
    data,
    ...(options?.requestId ? { requestId: options.requestId } : {}),
    ...(options?.message ? { message: options.message } : {}),
  };
  return {
    statusCode: 201,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(),
    },
    body: JSON.stringify(body),
  };
}

export function problem(details: ProblemDetails) {
  const body = {
    type: details.type || 'about:blank',
    title: details.title,
    status: details.status,
    ...(details.detail ? { detail: details.detail } : {}),
    ...(details.instance ? { instance: details.instance } : {}),
    ...(details.code ? { code: details.code } : {}),
    ...(details.correlationId ? { correlationId: details.correlationId } : {}),
    ...(details.errors ? { errors: details.errors } : {}),
  };
  return {
    statusCode: details.status,
    headers: {
      'Content-Type': 'application/problem+json',
      ...getCorsHeaders(),
    },
    body: JSON.stringify(body),
  };
}

