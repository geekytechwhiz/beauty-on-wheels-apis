import { generateIdempotencyKey } from './generate-idempotency-key';
import { InMemoryIdempotencyStore } from './in-memory-idempotency-store';

describe('idempotency', () => {
  describe('InMemoryIdempotencyStore', () => {
    it('detects duplicates after save', async () => {
      const store = new InMemoryIdempotencyStore();
      const key = 'evt-1';
      expect(await store.exists(key)).toBe(false);
      await store.save(key);
      expect(await store.exists(key)).toBe(true);
    });

    it('treats key as absent after TTL elapses', async () => {
      const store = new InMemoryIdempotencyStore();
      const key = 'short-lived';
      await store.save(key, { ttlSeconds: 0.01 });
      expect(await store.exists(key)).toBe(true);
      await new Promise((r) => setTimeout(r, 25));
      expect(await store.exists(key)).toBe(false);
    });
  });

  describe('generateIdempotencyKey', () => {
    it('is consistent for the same payload', () => {
      const payload = { a: 1, b: { c: 2 } };
      expect(generateIdempotencyKey(payload)).toBe(generateIdempotencyKey(payload));
    });

    it('matches regardless of object key order', () => {
      expect(generateIdempotencyKey({ x: 1, y: 2 })).toBe(
        generateIdempotencyKey({ y: 2, x: 1 }),
      );
    });

    it('differs for different payloads', () => {
      expect(generateIdempotencyKey({ a: 1 })).not.toBe(generateIdempotencyKey({ a: 2 }));
    });
  });
});
