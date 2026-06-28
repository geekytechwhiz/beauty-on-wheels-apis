import { DUE_SORT_SENTINEL_MS } from '../constants/task.constants';

/** Current instant as epoch milliseconds (platform wire format for task timestamps). */
export function nowEpochMs(): number {
  return Date.now();
}

/** Fixed-width decimal string so lexical order matches chronological order in DUE# sort keys. */
export function padEpochMs13(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid epoch milliseconds: ${ms}`);
  }
  return String(Math.floor(ms)).padStart(13, '0');
}

/** Schedule start persisted on META/LOOKUP at create (Option B §0 — resolve before write). */
export function resolveDueWindowStartAtCreate(
  dueWindowStart?: number,
  dueWindowEnd?: number,
): number | undefined {
  if (dueWindowStart != null && Number.isFinite(dueWindowStart)) {
    return Math.floor(dueWindowStart);
  }
  if (dueWindowEnd != null && Number.isFinite(dueWindowEnd)) {
    return Math.floor(dueWindowEnd);
  }
  return undefined;
}

export function dueWindowStartOrMaxMs(dueWindowStart?: number, dueWindowEnd?: number): number {
  const resolved = resolveDueWindowStartAtCreate(dueWindowStart, dueWindowEnd);
  if (resolved != null) {
    return resolved;
  }
  return DUE_SORT_SENTINEL_MS;
}

/** DueDate for Action Center calendar rules — falls back to StartDate when end is absent. */
export function resolveDueWindowEndMs(
  dueWindowStart?: number,
  dueWindowEnd?: number,
): number | undefined {
  if (dueWindowEnd != null && Number.isFinite(dueWindowEnd)) {
    return Math.floor(dueWindowEnd);
  }
  if (dueWindowStart != null && Number.isFinite(dueWindowStart)) {
    return Math.floor(dueWindowStart);
  }
  return undefined;
}

/** Local calendar date as `YYYY-MM-DD` in the given IANA timezone. */
export function calendarDateKey(epochMs: number, timeZone: string): string {
  assertValidTimeZone(timeZone);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

export function assertValidTimeZone(timeZone: string): void {
  const tz = timeZone?.trim();
  if (!tz) {
    throw new Error('timezone is required');
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
  } catch {
    const err = new Error(`Invalid timezone: ${tz}`) as Error & { statusCode: number; code: string };
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
}

export const DEFAULT_ACTION_CENTER_TIMEZONE = 'UTC';
