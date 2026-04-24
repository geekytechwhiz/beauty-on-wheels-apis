export type RetryBackoffStrategy = 'exponential' | 'fixed';

/** Optional logger compatible with common structured loggers (e.g. Winston). */
export type RetryLogger = {
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

export type RetryOptions = {
  maxAttempts: number;
  strategy: RetryBackoffStrategy;
  /** Milliseconds: fixed interval between attempts, or initial delay for exponential. */
  delayMs: number;
  /** Exponential only: multiplier per step after a failure (default 2). */
  factor?: number;
  /** Exponential only: cap on computed delay in milliseconds. */
  maxDelayMs?: number;
  /** Override default retryability; return false to fail immediately. */
  isRetryable?: (error: unknown) => boolean;
  /** If set, receives a message when a failed attempt will be retried. */
  logger?: RetryLogger;
  /** Invoked when a failed attempt will be retried, after the optional log, before the backoff sleep. */
  onBeforeRetry?: (info: RetryOnBeforeRetryInfo) => void;
};

export type RetryOnBeforeRetryInfo = {
  /** 1-based attempt that just failed. */
  failedAttempt: number;
  maxAttempts: number;
  waitMs: number;
  error: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Basic classification: abort/validation-style failures are not retried; 5xx/429 are. */
export function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return false;
  }
  if (typeof error === 'object' && error !== null && 'retryable' in error) {
    const r = (error as { retryable?: boolean }).retryable;
    if (typeof r === 'boolean') {
      return r;
    }
  }
  const statusCode = (error as { statusCode?: number }).statusCode;
  if (typeof statusCode === 'number') {
    if (statusCode === 429 || statusCode >= 500) {
      return true;
    }
    if (statusCode >= 400 && statusCode < 500) {
      return false;
    }
  }
  return true;
}

function delayAfterFailure(
  failedAttemptIndex: number,
  options: RetryOptions,
): number {
  const { strategy, delayMs, factor = 2, maxDelayMs } = options;
  switch (strategy) {
    case 'fixed':
      return delayMs;
    case 'exponential': {
      const raw = delayMs * Math.pow(factor, failedAttemptIndex - 1);
      if (maxDelayMs !== undefined && maxDelayMs > 0) {
        return Math.min(raw, maxDelayMs);
      }
      return raw;
    }
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}

/**
 * Invokes `fn` until it succeeds or `maxAttempts` is reached.
 * Waits between failures according to `strategy` and `delayMs`.
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxAttempts, isRetryable = defaultIsRetryable, logger, onBeforeRetry } = options;
  if (maxAttempts < 1) {
    throw new RangeError('retry: maxAttempts must be at least 1');
  }
  if (options.delayMs < 0) {
    throw new RangeError('retry: delayMs must be non-negative');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error) || attempt === maxAttempts) {
        throw error;
      }
      const waitMs = delayAfterFailure(attempt, options);
      logger?.warn('retry: attempt failed, backing off before next attempt', {
        attempt,
        maxAttempts,
        waitMs,
        strategy: options.strategy,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { value: String(error) },
      });
      onBeforeRetry?.({ failedAttempt: attempt, maxAttempts, waitMs, error });
      await sleep(waitMs);
    }
  }
  throw new Error('retry: unreachable');
}
