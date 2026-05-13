import { ZodError } from 'zod';

import { BaseError } from '@api-hub/utils';

import type { DlqConfig } from '../dlq/dlq-config';

/** How the transport surfaces retries vs framework-scheduled retries. */
export type TransportMode =
  | 'sqs-native'
  | 'framework-managed'
  | 'eventbridge'
  | 'sns'
  /**
   * DynamoDB Streams (Lambda partial batch failures). Handler failures surface as
   * `needs_transport_retry` per record without in-process retry sleeps; redelivery is driven by Lambda.
   */
  | 'dynamodb-stream';

/**
 * Single source of truth for retry / dead-letter / fail / discard (decision only; no I/O).
 */
export type DeliveryDecision =
  | {
      type: 'retry';
      delayMs?: number;
      nextRetryCount?: number;
      reason?: string;
    }
  | { type: 'dead_letter'; reason?: string }
  | { type: 'fail'; reason?: string }
  | { type: 'discard'; reason?: string };

export type EvaluateDeliveryPolicyParams = {
  /**
   * Delivery attempt counter (e.g. SQS ApproximateReceiveCount, or envelope retryCount).
   * 1-indexed first attempt.
   */
  effectiveAttempt: number;
  maxAttempts: number;
  dlq: DlqConfig;
  error?: unknown;
  /**
   * When true, may return `{ type: 'retry' }` while attempts remain.
   * Set false after in-process attempts are exhausted.
   */
  allowTransportRetry?: boolean;
  delayMs?: number;
  transportMode?: TransportMode;
  /**
   * Idempotency store reports in-flight contention — retry while attempts remain, same as retryable errors.
   */
  idempotencyContention?: boolean;
};

/**
 * True when the handler error should never be retried (poison / bad input).
 */
export function isNonRetryableHandlerError(error: unknown): boolean {
  if (error instanceof BaseError) {
    if (error.retryable === false) {
      return true;
    }
    if (error.retryable === true) {
      return false;
    }
  }

  if (!(error instanceof Error)) {
    return false;
  }
  if (error instanceof ZodError) {
    return true;
  }
  const n = error.name;
  return n === 'ValidationError' || n === 'SchemaValidationError';
}

/**
 * After a handler invocation fails, decide whether another delivery attempt remains.
 */
export function classifyAfterHandlerFailure(params: {
  failedAttemptNumber: number;
  maxAttempts: number;
}): 'retry' | 'exhausted' {
  return params.failedAttemptNumber < params.maxAttempts ? 'retry' : 'exhausted';
}

/**
 * When retries are exhausted, choose between DLQ candidate vs propagating failure.
 */
export function outcomeWhenExhausted(
  dlq: DlqConfig,
): 'dead_letter_candidate' | 'propagate_error' {
  return dlq.enabled ? 'dead_letter_candidate' : 'propagate_error';
}

export type DecideDeliveryDisposition =
  | 'dead_letter_candidate'
  | 'propagate_error'
  | 'retry';

/**
 * High-level disposition used by legacy call sites.
 */
export function decideDeliveryDisposition(params: {
  failedAttemptNumber: number;
  maxAttempts: number;
  dlq: DlqConfig;
  error?: unknown;
}): DecideDeliveryDisposition {
  if (params.error !== undefined && isNonRetryableHandlerError(params.error)) {
    return outcomeWhenExhausted(params.dlq);
  }

  const phase = classifyAfterHandlerFailure({
    failedAttemptNumber: params.failedAttemptNumber,
    maxAttempts: params.maxAttempts,
  });

  if (phase === 'retry') {
    return 'retry';
  }

  return outcomeWhenExhausted(params.dlq);
}

/**
 * Retry vs dead-letter vs fail vs discard (decision-only; no I/O).
 *
 * Order: non-retryable → discard or dead_letter → retry (if allowed) → dead letter when exhausted and DLQ on → otherwise fail.
 */
export function evaluateDeliveryPolicy(
  params: EvaluateDeliveryPolicyParams,
): DeliveryDecision {
  const {
    effectiveAttempt,
    maxAttempts,
    dlq,
    error,
    allowTransportRetry = true,
    delayMs,
    idempotencyContention,
  } = params;

  if (idempotencyContention) {
    if (
      allowTransportRetry &&
      classifyAfterHandlerFailure({
        failedAttemptNumber: effectiveAttempt,
        maxAttempts,
      }) === 'retry'
    ) {
      return {
        type: 'retry',
        nextRetryCount: effectiveAttempt + 1,
        delayMs: delayMs ?? 200,
        reason: 'idempotency_contention',
      };
    }
    if (dlq.enabled) {
      return {
        type: 'dead_letter',
        reason: 'idempotency_contention_exhausted',
      };
    }
    return {
      type: 'fail',
      reason: 'idempotency_contention_exhausted',
    };
  }

  if (error !== undefined && isNonRetryableHandlerError(error)) {
    if (dlq.enabled && dlq.strategy) {
      return {
        type: 'dead_letter',
        reason: 'non_retryable_error',
      };
    }
    return {
      type: 'discard',
      reason: 'non_retryable_error',
    };
  }

  if (
    allowTransportRetry &&
    classifyAfterHandlerFailure({
      failedAttemptNumber: effectiveAttempt,
      maxAttempts,
    }) === 'retry'
  ) {
    return {
      type: 'retry',
      nextRetryCount: effectiveAttempt + 1,
      delayMs: delayMs ?? 200,
      reason: 'attempts_remain',
    };
  }

  if (dlq.enabled) {
    return {
      type: 'dead_letter',
      reason: 'max_attempts_exceeded',
    };
  }

  return {
    type: 'fail',
    reason: 'retry_exhausted_no_dlq',
  };
}

/** @deprecated Use {@link evaluateDeliveryPolicy} */
export function resolveDeliveryDecision(
  params: EvaluateDeliveryPolicyParams,
): DeliveryDecision {
  return evaluateDeliveryPolicy(params);
}

export type ResolveDeliveryDecisionParams = EvaluateDeliveryPolicyParams;
