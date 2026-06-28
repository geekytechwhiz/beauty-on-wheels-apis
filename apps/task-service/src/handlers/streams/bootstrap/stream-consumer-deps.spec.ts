import {
  buildTaskStreamConsumerDeps,
  resetTaskStreamConsumerDepsCache,
} from './stream-consumer-deps';

describe('stream-consumer-deps', () => {
  afterEach(() => {
    resetTaskStreamConsumerDepsCache();
  });

  it('returns cached retry and dlq overrides', () => {
    const first = buildTaskStreamConsumerDeps();
    const second = buildTaskStreamConsumerDeps();
    expect(first).toBe(second);
    expect(first).toMatchObject({
      retry: { maxAttempts: 3, strategy: 'exponential', delayMs: 200 },
      dlq: { enabled: false },
    });
  });

  it('resetTaskStreamConsumerDepsCache rebuilds deps', () => {
    const first = buildTaskStreamConsumerDeps();
    resetTaskStreamConsumerDepsCache();
    const second = buildTaskStreamConsumerDeps();
    expect(second).not.toBe(first);
    expect(second).toMatchObject({ dlq: { enabled: false } });
  });
});
