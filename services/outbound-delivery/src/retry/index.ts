/**
 * Retry + DLQ placeholder for failed deliveries.
 */
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  dlqArn?: string;
}

const defaultConfig: RetryConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
};

export function getRetryConfig(): RetryConfig {
  return defaultConfig;
}

export async function sendToDlq(
  _message: unknown,
  _dlqArn: string
): Promise<void> {
  // Placeholder: SQS send to DLQ or equivalent
}
