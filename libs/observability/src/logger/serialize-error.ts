import { safeParse } from '../core/utils';

type ErrorLike = {
  name?: string;
  message: string;
  stack?: string;
  code?: string;
  statusCode?: number;
  details?: unknown;
  cause?: unknown;
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

function serializeErrorLike(error: ErrorLike): Record<string, unknown> {
  return {
    name: error.name ?? 'Error',
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    ...(typeof error.code === 'string' ? { code: error.code } : {}),
    ...(typeof error.statusCode === 'number' ? { statusCode: error.statusCode } : {}),
    ...(error.details !== undefined ? { details: safeParse(error.details) } : {}),
    ...(error.cause !== undefined ? { cause: safeParse(error.cause) } : {}),
  };
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (isErrorLike(error)) {
    return serializeErrorLike(error);
  }

  if (typeof error === 'object' && error !== null) {
    return {
      name: 'SerializedUnknownRejection',
      message: 'Non-Error value logged',
      value: safeParse(error),
    };
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
}
