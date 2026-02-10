/**
 * Unit tests for legacy random ID generator.
 */

import { generateRandomIdWithTimestamp } from './random-id';

describe('random-id', () => {
  it('returns a string with length 8 + timestamp digits', () => {
    const id = generateRandomIdWithTimestamp();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThanOrEqual(8 + 10);
    const timestampPart = id.slice(8);
    expect(Number(timestampPart)).toBeGreaterThan(0);
    expect(Number(timestampPart)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('starts with alphanumeric characters', () => {
    const id = generateRandomIdWithTimestamp();
    const prefix = id.slice(0, 8);
    expect(prefix).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it('produces different values on successive calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      ids.add(generateRandomIdWithTimestamp());
    }
    expect(ids.size).toBe(5);
  });
});
