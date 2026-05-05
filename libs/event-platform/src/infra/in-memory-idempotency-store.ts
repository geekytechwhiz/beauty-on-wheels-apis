import type { IdempotencyStore } from '../core/idempotency/store-idempotency.strategy';

export type InMemoryIdempotencyStoreOptions = {
  /** Treat stale IN_PROGRESS as reclaimable after this many ms (default 5 minutes). */
  lockTimeoutMs?: number;
};

type Row = {
  status: 'IN_PROGRESS' | 'COMPLETED';
  updatedAtMs: number;
};

/**
 * Process-local {@link IdempotencyStore} for tests and single-worker dev.
 * For Lambda with concurrency > 1 or multiple instances, use {@link DynamoDbIdempotencyStore}.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly rows = new Map<string, Row>();
  private readonly lockTimeoutMs: number;

  constructor(options?: InMemoryIdempotencyStoreOptions) {
    this.lockTimeoutMs = options?.lockTimeoutMs ?? 5 * 60 * 1000;
  }

  async claim(key: string): Promise<'ACQUIRED' | 'DUPLICATE' | 'IN_PROGRESS'> {
    const now = Date.now();
    const existing = this.rows.get(key);

    if (!existing) {
      this.rows.set(key, { status: 'IN_PROGRESS', updatedAtMs: now });
      return 'ACQUIRED';
    }

    if (existing.status === 'COMPLETED') {
      return 'DUPLICATE';
    }

    if (now - existing.updatedAtMs > this.lockTimeoutMs) {
      existing.updatedAtMs = now;
      return 'ACQUIRED';
    }

    return 'IN_PROGRESS';
  }

  async markCompleted(key: string): Promise<void> {
    const row = this.rows.get(key);
    if (row) {
      row.status = 'COMPLETED';
      row.updatedAtMs = Date.now();
    } else {
      this.rows.set(key, { status: 'COMPLETED', updatedAtMs: Date.now() });
    }
  }
}
