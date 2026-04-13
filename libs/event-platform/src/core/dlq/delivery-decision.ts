import type { DlqConfig } from './dlq-config';

/**
 * After a handler invocation fails, decide whether another attempt will run
 * (retry path inside {@link retry}) vs retries are exhausted.
 */
export function classifyAfterHandlerFailure(params: {
  /** 1-based index of the attempt that failed. */
  failedAttemptNumber: number;
  maxAttempts: number;
}): 'retry' | 'exhausted' {
  if (params.failedAttemptNumber < params.maxAttempts) {
    return 'retry';
  }
  return 'exhausted';
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
  failedAttemptNumber: number;
  maxAttempts: number;
  dlq: DlqConfig;
}): 'retry' | 'dead_letter_candidate' | 'propagate_error' {
  const phase = classifyAfterHandlerFailure({
    failedAttemptNumber: params.failedAttemptNumber,
    maxAttempts: params.maxAttempts,
  });
  if (phase === 'retry') {
    return 'retry';
  }
  return outcomeWhenExhausted(params.dlq);
}
