import axios from 'axios';
import { BaseError } from '@api-hub/utils';

export type UpstreamDependencyTag = 'user-service' | 'organization-service';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notifyUpstreamRetries(
  dependency: UpstreamDependencyTag,
  retryAttempts: number,
): void {
  if (retryAttempts <= 0) return;
  void import('@api-hub/observability')
    .then((m) => m.recordUpstreamRetryAttempts(dependency, retryAttempts))
    .catch(() => {});
}

class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private readonly threshold: number,
    private readonly halfOpenAfterMs: number,
  ) {}

  allow(): boolean {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.halfOpenAfterMs) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  recordFailure(): void {
    this.failures += 1;
    this.openedAt = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();

function circuitBreakerFor(dependency: UpstreamDependencyTag): CircuitBreaker {
  const threshold = Number(process.env.UPSTREAM_CB_FAILURE_THRESHOLD ?? '5');
  const halfOpenMs = Number(process.env.UPSTREAM_CB_HALF_OPEN_MS ?? '15000');
  if (!breakers.has(dependency)) {
    breakers.set(dependency, new CircuitBreaker(threshold, halfOpenMs));
  }
  return breakers.get(dependency)!;
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableTransportError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return true;
  if (!err.response && Boolean(err.code)) return true;
  if (err.response) return isTransientHttpStatus(err.response.status);
  return false;
}

/**
 * GET with retries on transient HTTP/network failures, optional circuit breaker, and dependency metrics.
 */
export async function executeUpstreamGet(options: {
  dependency: UpstreamDependencyTag;
  url: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  /** Env key for max retries (default `UPSTREAM_HTTP_MAX_RETRIES`). */
  maxRetriesEnvKey?: string;
}): Promise<{ status: number; data: unknown }> {
  const retriesEnv =
    options.maxRetriesEnvKey ?? 'UPSTREAM_HTTP_MAX_RETRIES';
  const maxRetries = Math.max(
    0,
    Number(process.env[retriesEnv] ?? process.env.UPSTREAM_HTTP_MAX_RETRIES ?? '2'),
  );

  const breaker = circuitBreakerFor(options.dependency);
  if (!breaker.allow()) {
    throw new BaseError(
      `${options.dependency} circuit breaker open`,
      503,
      'UPSTREAM_CIRCUIT_OPEN',
      [{ message: 'Upstream temporarily unavailable' }],
      {
        retryable: true,
        metadata: { dependency: options.dependency },
      },
    );
  }

  let retryAttempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get(options.url, {
        headers: options.headers,
        timeout: options.timeoutMs,
        validateStatus: () => true,
      });

      if (isTransientHttpStatus(res.status) && attempt < maxRetries) {
        retryAttempts++;
        await sleep(Math.min(300 * 2 ** attempt, 5000));
        continue;
      }

      if (res.status >= 500 || res.status === 429) {
        breaker.recordFailure();
      } else {
        breaker.recordSuccess();
      }

      if (retryAttempts > 0) {
        notifyUpstreamRetries(options.dependency, retryAttempts);
      }
      return { status: res.status, data: res.data };
    } catch (err) {
      const canRetry = isRetryableTransportError(err) && attempt < maxRetries;
      if (canRetry) {
        retryAttempts++;
        await sleep(Math.min(300 * 2 ** attempt, 5000));
        continue;
      }

      breaker.recordFailure();
      if (retryAttempts > 0) {
        notifyUpstreamRetries(options.dependency, retryAttempts);
      }

      const msg = axios.isAxiosError(err) ? err.message : 'Upstream request failed';
      throw new BaseError(msg, 502, 'UPSTREAM_ERROR', [{ message: msg }], {
        retryable: true,
        metadata: { dependency: options.dependency },
      });
    }
  }

  breaker.recordFailure();
  if (retryAttempts > 0) {
    notifyUpstreamRetries(options.dependency, retryAttempts);
  }

  return { status: 502, data: undefined };
}
