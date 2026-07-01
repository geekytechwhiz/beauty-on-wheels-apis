import { isConditionalWriteConflictAtIndex } from '@api-hub/utils';

import { TRANSACT_INDEX_META } from '../constants/task.constants';

export function assertTaskTable(): string {
  const t = process.env.TASK_TABLE;
  if (!t) {
    throw new Error('TASK_TABLE environment variable is not set');
  }
  return t;
}

export function isMetaConditionalFailure(err: unknown): boolean {
  return isConditionalWriteConflictAtIndex(err, TRANSACT_INDEX_META);
}

export const TASK_LIST_DEFAULT_PAGE_SIZE = 50;
export const TASK_LIST_MAX_PAGE_SIZE = 200;

/** Max DynamoDB query rounds when filtering by derived surfaceSection. */
export const TASK_LIST_SURFACE_FILTER_MAX_ROUNDS = 5;

/** Max DynamoDB query rounds when aggregating care-plan task status summary. */
export const TASK_STATUS_SUMMARY_MAX_QUERY_ROUNDS = 20;

/** Opaque GET /tasks/{id}/history pagination: DynamoDB Query `LastEvaluatedKey` as `nextToken`. */
export function encodeTaskHistoryCursor(
  lastEvaluatedKey: Record<string, unknown> | undefined,
): string | undefined {
  if (!lastEvaluatedKey || Object.keys(lastEvaluatedKey).length === 0) return undefined;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url');
}

export function decodeTaskHistoryCursor(token: string | undefined): Record<string, unknown> | undefined {
  const t = token?.trim();
  if (!t) return undefined;
  try {
    const json = Buffer.from(t, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      invalidTaskHistoryCursor();
    }
    return parsed as Record<string, unknown>;
  } catch {
    invalidTaskHistoryCursor();
  }
}

function invalidTaskHistoryCursor(): never {
  const e = new Error('Invalid nextToken') as Error & { statusCode: number; code: string };
  e.statusCode = 400;
  e.code = 'VALIDATION_ERROR';
  throw e;
}
