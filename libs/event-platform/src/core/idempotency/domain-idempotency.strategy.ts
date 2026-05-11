// core/idempotency/domain-idempotency.strategy.ts

import type { IdempotencyStrategy } from './idempotency-strategy';
import type { IdempotencyContext, IdempotencyResult } from './types';
import { isConditionalCheckFailure, DuplicateEventError } from './utils';

export class DomainIdempotencyStrategy implements IdempotencyStrategy {

  async before(context: IdempotencyContext): Promise<IdempotencyResult> {
    // 🔒 Basic validation
    if (!context?.eventId) {
      throw new Error('Missing eventId for idempotency');
    }

    return 'PROCEED';
  }

  async afterSuccess(): Promise<void> {
    // ✔ No-op — domain write already ensured idempotency
  }

  async onError(
    context: IdempotencyContext,
    error: unknown
  ): Promise<void> {

    if (isConditionalCheckFailure(error)) {
      // 🔥 Convert to domain-level duplicate signal
      throw new DuplicateEventError(context.eventId);
    }

    // propagate other errors
    throw error;
  }
}

