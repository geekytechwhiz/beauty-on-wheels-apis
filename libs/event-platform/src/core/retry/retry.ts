// core/retry/retry.ts

import { RetryOptions } from '../../typings/consumer.types';
import { RetryContext } from '../../typings/consumer.types';
import { RetryJitter } from '../../typings/consumer.types';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function applyJitter(delay: number, jitter?: RetryJitter): number {
  switch (jitter) {
    case 'full':
      return Math.random() * delay;
    case 'partial':
      return delay / 2 + Math.random() * (delay / 2);
    default:
      return delay;
  }
}

function delayAfterFailure(attempt: number, options: RetryOptions): number {
  const { strategy, delayMs, factor = 2, maxDelayMs } = options;

  let base =
    strategy === 'fixed'
      ? delayMs
      : delayMs * Math.pow(factor, attempt - 1);

  if (maxDelayMs) base = Math.min(base, maxDelayMs);

  return applyJitter(base, options.jitter);
}

function withTimeout<T>(promise: Promise<T>, ms?: number): Promise<T> {
  if (!ms) return promise;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('RetryTimeout')), ms)
    ),
  ]);
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  context?: RetryContext
): Promise<T> {
  const {
    maxAttempts,
    isRetryable = () => true,
    shouldRetryResult,
    shouldStop,
    logger,
    onBeforeRetry,
    onComplete,
    signal,
  } = options;

  let attempt = context?.currentRetryCount ?? 0;

  for (; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('RetryAborted');

    try {
      const result = await withTimeout(fn(), options.timeoutMs);

      if (shouldRetryResult?.(result)) {
        throw new Error('RetryableResult');
      }

      onComplete?.({ success: true, attempts: attempt + 1 });
      return result;

    } catch (error) {
      if (
        attempt + 1 >= maxAttempts ||
        !isRetryable(error) ||
        shouldStop?.(error, attempt + 1)
      ) {
        onComplete?.({ success: false, attempts: attempt + 1 });
        throw error;
      }

      const waitMs = delayAfterFailure(attempt + 1, options);

      logger?.warn('retry: attempt failed', {
        attempt: attempt + 1,
        waitMs,
        error: error instanceof Error ? error.message : String(error),
      });

      onBeforeRetry?.({
        failedAttempt: attempt + 1,
        maxAttempts,
        waitMs,
        error,
      });

      await sleep(waitMs);
    }
  }

  throw new Error('retry: unreachable');
}