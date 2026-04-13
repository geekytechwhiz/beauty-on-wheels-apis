import type { IdempotencySaveOptions, IdempotencyStore } from './idempotency-store';

type Entry = {
  expiresAtMs?: number;
};

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();

  async exists(key: string): Promise<boolean> {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }
    if (entry.expiresAtMs !== undefined && Date.now() >= entry.expiresAtMs) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  async save(key: string, options?: IdempotencySaveOptions): Promise<void> {
    const ttlSeconds = options?.ttlSeconds;
    const expiresAtMs =
      ttlSeconds !== undefined && ttlSeconds > 0
        ? Date.now() + ttlSeconds * 1000
        : undefined;
    this.entries.set(key, { expiresAtMs });
  }
}
