import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';

import { toBaseError } from '@api-hub/utils';

import {
  isAckedWithoutBatchFailure,
  type ProcessSingleResult,
} from '../engine/processor/process-outcomes';

export type TransportOutcomeMapperOptions = {
  supportsPartialBatch: boolean;
  resolveBatchItemIdentifier?: (rawEvent: unknown) => string;
};

export class TransportRetryRequiredError extends Error {
  readonly causeError: unknown;

  constructor(message: string, causeError?: unknown) {
    super(message);
    this.name = 'TransportRetryRequiredError';
    this.causeError = causeError;
  }
}

export function coerceConsumeResultToSqsBatchResponse(
  event: SQSEvent,
  result: unknown,
): SQSBatchResponse {
  if (
    result !== null &&
    typeof result === 'object' &&
    Array.isArray((result as SQSBatchResponse).batchItemFailures)
  ) {
    return result as SQSBatchResponse;
  }

  const single = result as ProcessSingleResult | undefined;
  if (!single || typeof single !== 'object' || !('outcome' in single)) {
    return { batchItemFailures: [] };
  }

  const itemIdentifier = event.Records?.[0]?.messageId ?? 'unknown';
  if (isAckedWithoutBatchFailure(single.outcome)) {
    return { batchItemFailures: [] };
  }

  return { batchItemFailures: [{ itemIdentifier }] };
}

export function mapSingleTransportOutcome(
  result: ProcessSingleResult,
  options: TransportOutcomeMapperOptions,
): void {
  if (options.supportsPartialBatch) {
    return;
  }

  if (result.outcome === 'needs_transport_retry') {
    throw new TransportRetryRequiredError(
      'Transport retry required',
      result.error,
    );
  }

  if (!isAckedWithoutBatchFailure(result.outcome)) {
    throw toBaseError(result.error ?? new Error(`Event processing failed: ${result.outcome}`));
  }
}

export function mapTransportHandlerResult<TResult>(
  rawEvent: unknown,
  result: unknown,
  options: TransportOutcomeMapperOptions,
): TResult {
  if (
    result !== null &&
    typeof result === 'object' &&
    Array.isArray((result as SQSBatchResponse).batchItemFailures)
  ) {
    return result as TResult;
  }

  if (result && typeof result === 'object' && 'outcome' in result) {
    mapSingleTransportOutcome(result as ProcessSingleResult, options);
    return undefined as TResult;
  }

  return result as TResult;
}
