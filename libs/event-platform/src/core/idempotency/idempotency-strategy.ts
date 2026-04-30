// core/idempotency/idempotency-strategy.ts

import type { IdempotencyContext, IdempotencyResult } from './types';

export interface IdempotencyStrategy {
  before(context: IdempotencyContext): Promise<IdempotencyResult>;
  afterSuccess(context: IdempotencyContext): Promise<void>;
  onError(context: IdempotencyContext, error: unknown): Promise<void>;
}