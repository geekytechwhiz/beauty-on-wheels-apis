import { TASK_LIST_DEFAULT_PAGE_SIZE, TASK_LIST_MAX_PAGE_SIZE } from '@api-hub/task-core';

function throwVal(
  message: string,
  statusCode = 400,
  code = 'VALIDATION_ERROR',
): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  throw err;
}

export function parsePageSize(raw: string | undefined): number {
  if (!raw?.trim()) return TASK_LIST_DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throwVal('pageSize must be a positive integer', 400, 'VALIDATION_ERROR');
  }
  if (n > TASK_LIST_MAX_PAGE_SIZE) {
    throwVal(`pageSize must not exceed ${TASK_LIST_MAX_PAGE_SIZE}`, 400, 'VALIDATION_ERROR');
  }
  return n;
}

export function parseOptionalEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throwVal(`${fieldName} must be one of: ${allowed.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
  return value as T;
}

/** Optional trimmed non-empty string (metadata value codes from UI). */
export function parseOptionalNonEmptyString(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value || undefined;
}
