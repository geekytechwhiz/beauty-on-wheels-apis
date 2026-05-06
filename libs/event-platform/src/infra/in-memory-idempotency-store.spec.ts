import { InMemoryIdempotencyStore } from './in-memory-idempotency-store';

describe('InMemoryIdempotencyStore', () => {
  it('acquires then marks completed and treats second claim as duplicate', async () => {
    const store = new InMemoryIdempotencyStore();
    await expect(store.claim('evt-1')).resolves.toBe('ACQUIRED');
    await store.markCompleted('evt-1');
    await expect(store.claim('evt-1')).resolves.toBe('DUPLICATE');
  });

  it('returns IN_PROGRESS while another worker holds a fresh lock', async () => {
    const store = new InMemoryIdempotencyStore({ lockTimeoutMs: 60_000 });
    await expect(store.claim('evt-2')).resolves.toBe('ACQUIRED');
    await expect(store.claim('evt-2')).resolves.toBe('IN_PROGRESS');
  });

  it('reclaims stale IN_PROGRESS locks', async () => {
    const store = new InMemoryIdempotencyStore({ lockTimeoutMs: 1 });
    await expect(store.claim('evt-3')).resolves.toBe('ACQUIRED');
    await new Promise((r) => setTimeout(r, 5));
    await expect(store.claim('evt-3')).resolves.toBe('ACQUIRED');
  });
});
