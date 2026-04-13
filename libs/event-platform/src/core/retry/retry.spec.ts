import { defaultIsRetryable, retry } from './retry';

describe('retry', () => {
  it('succeeds after transient failures (fixed backoff)', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 2) {
          throw new Error('transient');
        }
        return 'ok';
      },
      { maxAttempts: 3, strategy: 'fixed', delayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('fails after maxAttempts when fn always throws', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls += 1;
          throw new Error('always');
        },
        { maxAttempts: 3, strategy: 'fixed', delayMs: 1 },
      ),
    ).rejects.toThrow('always');
    expect(calls).toBe(3);
  });

  it('succeeds after failures with exponential strategy', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error('retry');
        }
        return 'done';
      },
      { maxAttempts: 4, strategy: 'exponential', delayMs: 1, factor: 2 },
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('does not retry when isRetryable returns false', async () => {
    let calls = 0;
    const err = Object.assign(new Error('nope'), { retryable: false });
    await expect(
      retry(
        async () => {
          calls += 1;
          throw err;
        },
        {
          maxAttempts: 5,
          strategy: 'fixed',
          delayMs: 1,
          isRetryable: defaultIsRetryable,
        },
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });
});

describe('defaultIsRetryable', () => {
  it('treats AbortError as non-retryable', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(defaultIsRetryable(err)).toBe(false);
  });

  it('treats 503 as retryable', () => {
    expect(defaultIsRetryable({ statusCode: 503 })).toBe(true);
  });

  it('treats 400 as non-retryable', () => {
    expect(defaultIsRetryable({ statusCode: 400 })).toBe(false);
  });
});
