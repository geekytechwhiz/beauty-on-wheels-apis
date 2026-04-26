import type { DlqConfig } from './dlq-config';

/**
 * After a handler invocation fails, decide whether another attempt will run
 * (retry path inside {@link retry}) vs retries are exhausted.
 */
export function classifyAfterHandlerFailure(params: {
  retryCount: number;
  maxAttempts: number;
}): 'retry' | 'exhausted' {
  return params.retryCount < params.maxAttempts
    ? 'retry'
    : 'exhausted';
}
/**
 * When retries are exhausted, choose between surfacing a DLQ candidate (for observability /
 * custom handling) vs propagating failure as a normal throw.
 */
export function outcomeWhenExhausted(dlq: DlqConfig): 'dead_letter_candidate' | 'propagate_error' {
  return dlq.enabled ? 'dead_letter_candidate' : 'propagate_error';
}

/**
 * Combines retry exhaustion with DLQ awareness (decision-only; no I/O).
 */
export function decideDeliveryDisposition(params: {
  retryCount: number;
  maxAttempts: number;
  dlq: DlqConfig;
  error?: unknown;
}): 'retry' | 'dead_letter_candidate' | 'propagate_error' {

  if (params.retryCount < params.maxAttempts) {
    return 'retry';
  }

  // optional: non-retryable error
  if (params.error && isNonRetryableError(params.error)) {
    return 'propagate_error';
  }

  return params.dlq.enabled
    ? 'dead_letter_candidate'
    : 'propagate_error';
}

function isNonRetryableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (
      error.name === 'ValidationError' ||
      error.name === 'SchemaValidationError'
    )
  );
}