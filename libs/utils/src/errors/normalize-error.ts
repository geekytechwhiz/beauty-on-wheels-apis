import { ZodError } from 'zod';

import { BaseError } from './base.error';

function defaultCodeForStatus(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'INVALID_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'RESOURCE_NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'INVALID_REQUEST';
    case 429:
      return 'INVALID_REQUEST';
    case 502:
      return 'UPSTREAM_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}

function detailMessage(error: Error): string {
  return error.message || 'Unexpected error';
}

type ErrorLike = {
  name?: string;
  message: string;
  stack?: string;
  statusCode?: number;
  code?: string;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
  details?: BaseError['details'];
};

function isErrorLike(error: unknown): error is ErrorLike {
  if (error instanceof Error) {
    return true;
  }
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as Record<string, unknown>;
  return typeof candidate.message === 'string';
}

function baseErrorFromErrorLike(error: ErrorLike): BaseError {
  const msg = error.message || 'Unexpected error';
  const statusCode =
    typeof error.statusCode === 'number' ? error.statusCode : 500;
  const code =
    typeof error.code === 'string' ? error.code : defaultCodeForStatus(statusCode);
  return new BaseError(
    msg,
    statusCode,
    code,
    error.details ?? [{ message: msg }],
    {
      retryable:
        error.retryable ?? [502, 503, 504].includes(statusCode),
      metadata: {
        ...(typeof error.name === 'string' ? { originalName: error.name } : {}),
        ...error.metadata,
      },
    },
  );
}

/**
 * Normalizes any thrown value to {@link BaseError} for middleware boundaries and logging.
 */
export function toBaseError(error: unknown): BaseError {
  if (error instanceof BaseError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new BaseError(
      'Validation failed',
      400,
      'VALIDATION_ERROR',
      error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
      { retryable: false },
    );
  }

  if (error instanceof Error) {
    const any = error as Error & {
      statusCode?: number;
      code?: string;
      retryable?: boolean;
      metadata?: Record<string, unknown>;
      details?: BaseError['details'];
    };
    const msg = detailMessage(any);
    const code =
      typeof any.code === 'string' ? any.code : defaultCodeForStatus(any.statusCode ?? 500);
    return new BaseError(
      msg,
      any.statusCode ?? 500,
      code,
      any.details ?? [{ message: msg }],
      {
        retryable:
          any.retryable ??
          [502, 503, 504].includes(any.statusCode ?? 0),
        metadata: {
          originalName: any.name,
          ...any.metadata,
        },
      },
    );
  }

  if (typeof error === 'string') {
    return new BaseError(error, 500, 'INTERNAL_ERROR', [{ message: error }], {
      retryable: false,
    });
  }

  if (isErrorLike(error)) {
    return baseErrorFromErrorLike(error);
  }

  return new BaseError(
    'Unexpected non-Error rejection',
    500,
    'INTERNAL_ERROR',
    [{ message: 'Unexpected non-Error rejection' }],
    {
      retryable: false,
      metadata: { thrownType: typeof error },
    },
  );
}

/** Stable code string for metrics / light logs when `error` may be unknown. */
export function errorCodeFromUnknown(error: unknown): string {
  if (error instanceof BaseError) {
    return error.code;
  }
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}
