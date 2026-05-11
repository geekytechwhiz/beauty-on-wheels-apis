export type ProcessSingleOutcome =
  | 'success'
  | 'duplicate'
  | 'dead_letter'
  | 'retry_scheduled'
  | 'discard'
  /** SQS/native redelivery — surface to partial-batch failure without throwing across the processor boundary */
  | 'needs_transport_retry';

export type ProcessSingleResult = {
  outcome: ProcessSingleOutcome;
  /** Populated for terminal failure paths (e.g. DLQ / discard) when callers need the original error */
  error?: unknown;
};

const OUTCOMES_THAT_ACK_WITHOUT_BATCH_FAILURE: ReadonlySet<ProcessSingleOutcome> = new Set([
  'success',
  'duplicate',
  'dead_letter',
  'retry_scheduled',
  'discard',
]);

export function isAckedWithoutBatchFailure(outcome: ProcessSingleOutcome): boolean {
  return OUTCOMES_THAT_ACK_WITHOUT_BATCH_FAILURE.has(outcome);
}
