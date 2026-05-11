export interface RetryStrategy {
  scheduleRetry(params: {
    rawEvent: unknown;
    retryCount: number;
    delayMs: number;
  }): Promise<void>;
}
export type RetryConfig = {
  maxAttempts: number;
  delayMs: number;
  strategy?: RetryStrategy;
};
