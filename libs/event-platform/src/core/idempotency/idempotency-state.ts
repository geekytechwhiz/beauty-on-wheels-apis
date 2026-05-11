import type { IdempotencyResult } from './types';

/** Engine-level idempotency lifecycle (conceptual; store primitives map via {@link idempotencyBeforeResultToState}). */
export enum IdempotencyState {
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  DUPLICATE = 'DUPLICATE',
}

export function idempotencyBeforeResultToState(result: IdempotencyResult): IdempotencyState {
  switch (result) {
    case 'PROCEED':
      return IdempotencyState.NEW;
    case 'DUPLICATE':
      return IdempotencyState.DUPLICATE;
    case 'RETRY':
      return IdempotencyState.IN_PROGRESS;
  }
}
