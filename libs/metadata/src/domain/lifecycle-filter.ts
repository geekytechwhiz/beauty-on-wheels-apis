import { STATUS } from '../constants';
import { ValidationError } from './errors';
import type { Status } from '../models/types';

/** Supported `status` query values for GET/LIST lifecycle filtering. */
export const LIFECYCLE_QUERY_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DELETED: 'DELETED',
  ALL: 'ALL',
} as const;

export type LifecycleQueryStatus = (typeof LIFECYCLE_QUERY_STATUS)[keyof typeof LIFECYCLE_QUERY_STATUS];

const LIFECYCLE_QUERY_SET = new Set<string>(Object.values(LIFECYCLE_QUERY_STATUS));

export function isLifecycleQueryStatus(value: unknown): value is LifecycleQueryStatus {
  return typeof value === 'string' && LIFECYCLE_QUERY_SET.has(value);
}

/**
 * Validates and normalizes optional `status` query param.
 * Omitted/empty → `undefined` (caller should use {@link resolveLifecycleStatuses}).
 */
export function parseLifecycleStatusQuery(raw: string | undefined): LifecycleQueryStatus | undefined {
  if (raw === undefined || String(raw).trim() === '') {
    return undefined;
  }
  const normalized = String(raw).trim().toUpperCase();
  if (!isLifecycleQueryStatus(normalized)) {
    throw new ValidationError('Invalid status filter', [
      { field: 'status', message: 'Must be ACTIVE, INACTIVE, DELETED, or ALL' },
    ]);
  }
  return normalized;
}

/**
 * Maps lifecycle query token to allowed record statuses.
 * Default (omitted) → ACTIVE only. ALL → ACTIVE + INACTIVE (never DELETED).
 */
export function resolveLifecycleStatuses(query: LifecycleQueryStatus | undefined): Status[] {
  switch (query) {
    case undefined:
    case LIFECYCLE_QUERY_STATUS.ACTIVE:
      return [STATUS.ACTIVE];
    case LIFECYCLE_QUERY_STATUS.INACTIVE:
      return [STATUS.INACTIVE];
    case LIFECYCLE_QUERY_STATUS.DELETED:
      return [STATUS.DELETED];
    case LIFECYCLE_QUERY_STATUS.ALL:
      return [STATUS.ACTIVE, STATUS.INACTIVE];
    default: {
      const _exhaustive: never = query;
      return _exhaustive;
    }
  }
}

/** Parse optional query `status` and resolve to allowed record statuses (GET/LIST). */
export function lifecycleStatusesFromQuery(raw: string | undefined): Status[] {
  return resolveLifecycleStatuses(parseLifecycleStatusQuery(raw));
}

export function recordMatchesLifecycleStatus(recordStatus: Status, allowedStatuses: Status[]): boolean {
  return allowedStatuses.includes(recordStatus);
}
