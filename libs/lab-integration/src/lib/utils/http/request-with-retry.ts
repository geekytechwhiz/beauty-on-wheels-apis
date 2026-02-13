import axios, {
  type AxiosRequestConfig,
  type AxiosResponse,
  type AxiosError,
} from 'axios';

export interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

/**
 * HTTP request wrapper with exponential backoff retry logic.
 * Only retries on retryable errors (5xx, 408, 429, network errors).
 * Does not retry on 4xx client errors (except 408, 429).
 */
export async function requestWithRetry<T = unknown>(
  config: AxiosRequestConfig,
  retryConfig: RetryConfig = {}
): Promise<AxiosResponse<T>> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    backoffMultiplier = 2,
  } = retryConfig;

  let lastError: AxiosError | Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.request<T>(config);
    } catch (error) {
      lastError = error as AxiosError | Error;

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error as AxiosError)) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelay * Math.pow(backoffMultiplier, attempt),
        maxDelay
      );

      console.log(
        `Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`
      );
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Determines if an error is retryable.
 * Retryable: 5xx, 408, 429, network errors
 * Not retryable: 4xx (except 408, 429)
 */
function isRetryableError(error: AxiosError): boolean {
  if (!error.response) {
    // Network error, timeout, etc.
    return true;
  }

  const status = error.response.status;

  // Retry on server errors (5xx)
  if (status >= 500) {
    return true;
  }

  // Retry on specific client errors
  if (status === 408 || status === 429) {
    return true;
  }

  // Don't retry on other 4xx errors
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
