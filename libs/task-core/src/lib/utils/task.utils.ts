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
