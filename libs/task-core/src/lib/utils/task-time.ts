import { DUE_SORT_SENTINEL_MS } from '../constants/task.constants';

/** Fixed-width decimal string so lexical order matches chronological order in DUE# sort keys. */
export function padEpochMs13(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid epoch milliseconds: ${ms}`);
  }
  return String(Math.floor(ms)).padStart(13, '0');
}

export function dueWindowStartOrMaxMs(dueWindowStart?: number, dueWindowEnd?: number): number {
  if (dueWindowStart != null && Number.isFinite(dueWindowStart)) {
    return Math.floor(dueWindowStart);
  }
  if (dueWindowEnd != null && Number.isFinite(dueWindowEnd)) {
    return Math.floor(dueWindowEnd);
  }
  return DUE_SORT_SENTINEL_MS;
}
