/**
 * Simple in-memory circuit breaker implementation.
 * States: CLOSED (normal), OPEN (failing), HALF_OPEN (testing)
 */
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly failureThreshold = 5,
    private readonly resetTimeoutMs = 60000, // 1 minute
    private readonly halfOpenMaxAttempts = 3
  ) {}

  /**
   * Execute a function with circuit breaker protection.
   * @throws CircuitBreakerOpenError if circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log('Circuit breaker entering HALF_OPEN state');
      } else {
        throw new CircuitBreakerOpenError(
          `Circuit breaker is OPEN. Next retry in ${Math.ceil(
            (this.resetTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000
          )}s`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxAttempts) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        console.log('Circuit breaker CLOSED after successful recovery');
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      console.log('Circuit breaker OPEN after failure in HALF_OPEN state');
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.log(`Circuit breaker OPEN after ${this.failureCount} failures`);
    }
  }

  getState(): string {
    return this.state;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}
