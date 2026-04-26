// core/idempotency/store-idempotency.strategy.ts

import type { IdempotencyStrategy } from './idempotency-strategy';
import type { IdempotencyContext, IdempotencyResult } from './types';

export interface IdempotencyStore {
  claim(key: string): Promise<'ACQUIRED' | 'DUPLICATE' | 'IN_PROGRESS'>;
  markCompleted(key: string): Promise<void>;
}

export class StoreIdempotencyStrategy implements IdempotencyStrategy {
  constructor(private readonly store: IdempotencyStore) {}

  async before(context: IdempotencyContext): Promise<IdempotencyResult> {
    if (!context?.eventId) {
      throw new Error('Missing eventId for idempotency');
    }

    let result: string;

    try {
      result = await this.store.claim(context.eventId);
    } catch (err) {
      // 🔥 Infrastructure failure → retry
      console.error('Idempotency claim failed', {
        eventId: context.eventId,
        error: err,
      });
      return 'RETRY';
    }

    switch (result) {
      case 'ACQUIRED':
        return 'PROCEED';

      case 'DUPLICATE':
        console.info('Duplicate event detected', {
          eventId: context.eventId,
        });
        return 'DUPLICATE';

      case 'IN_PROGRESS':
        console.warn('Event already in progress', {
          eventId: context.eventId,
        });
        return 'RETRY';

      default:
        // 🔥 Defensive programming
        console.error('Unknown idempotency state', {
          eventId: context.eventId,
          result,
        });
        return 'RETRY';
    }
  }

  async afterSuccess(context: IdempotencyContext): Promise<void> {
    try {
      await this.store.markCompleted(context.eventId);
    } catch (err) {
      // 🔥 Critical: don't break flow, but log
      console.error('Failed to mark idempotency completed', {
        eventId: context.eventId,
        error: err,
      });
    }
  }

  async onError(
    context: IdempotencyContext,
    error: unknown
  ): Promise<void> {
    // 🔥 Do NOT mark completed
    // 🔥 Do NOT delete lock
    // Let retry mechanism handle it

    console.error('Event processing failed (idempotency context)', {
      eventId: context.eventId,
      error,
    });

    // Optional future extension:
    // await this.store.markFailed(context.eventId)
  }
}