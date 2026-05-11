import { safeParse } from '../core/utils';

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const source = error as Error & { code?: string; cause?: unknown };
    return {
      name: source.name,
      message: source.message,
      stack: source.stack,
      ...(source.code ? { code: source.code } : {}),
      ...(source.cause ? { cause: safeParse(source.cause) } : {}),
    };
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
