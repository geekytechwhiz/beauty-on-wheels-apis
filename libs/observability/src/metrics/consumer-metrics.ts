import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';

import { getConfig } from '../config/config';

function createMetricsInstance(): Metrics {
  const cfg = getConfig();
  return new Metrics({
    namespace: cfg.metricsNamespace,
    serviceName: cfg.serviceName,
  });
}

function metricsPublishFailed(context: string, err: unknown): void {
   
  console.error(
    JSON.stringify({
      event: 'metrics_publish_failed',
      context,
      error: err instanceof Error ? err.message : String(err),
    })
  );
}

function addEventTypeDimension(m: Metrics, eventType?: string): void {
  if (typeof eventType === 'string' && eventType.length > 0) {
    m.addDimension('eventType', eventType);
  }
}

function safePublish(fn: (m: Metrics) => void): void {
  try {
    const m = createMetricsInstance();
    fn(m);
    m.publishStoredMetrics();
  } catch (error) {
    metricsPublishFailed('event_consumer', error);
  }
}

/** Emitted when `EventConsumer` finishes with `processed`. */
export function recordConsumerEventProcessed(eventType?: string): void {
  safePublish((m) => {
    addEventTypeDimension(m, eventType);
    m.addMetric('TotalEventsProcessed', MetricUnit.Count, 1);
  });
}

/**
 * Idempotent / duplicate key — not executed again.
 */
export function recordConsumerDuplicateEvent(eventType?: string): void {
  safePublish((m) => {
    addEventTypeDimension(m, eventType);
    m.addMetric('DuplicateEvents', MetricUnit.Count, 1);
  });
}

/**
 * Handler or pipeline failed and the error will be rethrown (not routed as DLQ candidate by consumer).
 */
export function recordConsumerFailure(eventType?: string, error?: unknown): void {
  safePublish((m) => {
    addEventTypeDimension(m, eventType);
    m.addMetric('ProcessingFailures', MetricUnit.Count, 1);
    m.addDimension('Error', error instanceof Error ? error.name : 'unknown');
  });
}

/**
 * Consumer classified the outcome as a dead-letter candidate (DLQ policy is still external).
 */
export function recordConsumerDeliveryDisposition(eventType?: string, disposition?: string): void {
  safePublish((m) => {
    addEventTypeDimension(m, eventType);
    m.addMetric('DeliveryDisposition', MetricUnit.Count, 1);
    m.addDimension('DeliveryDisposition', disposition ?? 'unknown');
  });
}

/**
 * A handler attempt failed and a retry was scheduled (before backoff). One increment per retry, not per message.
 */
export function recordConsumerRetry(eventType?: string, retryCount?: number): void {
  safePublish((m) => {
    addEventTypeDimension(m, eventType);
    m.addMetric('Retries', MetricUnit.Count, 1);
    m.addMetric('RetryCount', MetricUnit.Count, retryCount ?? 0);
  });
}

/** Successful or failed SQS ChangeMessageVisibility (heartbeat) API call. */
export function recordSqsVisibilityHeartbeatExtend(success: boolean): void {
  safePublish((m) => {
    m.addMetric('SqsVisibilityExtensions', MetricUnit.Count, 1);
    m.addDimension('Outcome', success ? 'Success' : 'Failure');
  });
}

/** Heartbeat tick skipped (e.g. Lambda almost out of time) — no SDK call. */
export function recordSqsVisibilityHeartbeatSkipped(reason: string): void {
  safePublish((m) => {
    m.addMetric('SqsVisibilityHeartbeatsSkipped', MetricUnit.Count, 1);
    m.addDimension('Reason', reason);
  });
}

/** Heartbeat loop ended without extending (Lambda timeout guard). */
export function recordSqsVisibilityHeartbeatLoopEnded(reason: string): void {
  safePublish((m) => {
    m.addMetric('SqsVisibilityHeartbeatLoopsEnded', MetricUnit.Count, 1);
    m.addDimension('Reason', reason);
  });
}

/** FIFO-aware SQS batch scheduling: one snapshot per Lambda batch. */
export function recordSqsFifoBatchScheduleSnapshot(input: {
  groupCount: number;
  recordCount: number;
}): void {
  safePublish((m) => {
    m.addMetric('SqsFifoBatchScheduleSnapshots', MetricUnit.Count, 1);
    m.addDimension('GroupCount', String(Math.min(100, input.groupCount)));
    m.addDimension('RecordCountBucket', fifoRecordCountBucket(input.recordCount));
  });
}

function fifoRecordCountBucket(n: number): string {
  if (n <= 1) {
    return '1';
  }
  if (n <= 5) {
    return '2-5';
  }
  if (n <= 10) {
    return '6-10';
  }
  return '11+';
}

/** Deferred FIFO-lane tails (not executed this invocation; reported as batch failures). */
export function recordSqsFifoBatchTailDeferred(count: number, reason: string): void {
  if (count <= 0) {
    return;
  }
  safePublish((m) => {
    m.addMetric('SqsFifoBatchTailsDeferred', MetricUnit.Count, count);
    m.addDimension('Reason', reason);
  });
}

/** Poison short-circuit: receive count threshold met before handler ran. */
export function recordSqsFifoBatchPoisonShortCircuit(count: number): void {
  if (count <= 0) {
    return;
  }
  safePublish((m) => {
    m.addMetric('SqsFifoBatchPoisonShortCircuits', MetricUnit.Count, count);
  });
}

/** One Lambda batch of DynamoDB stream records (before per-record processing). */
export function recordDynamoStreamBatchDispatch(recordCount: number): void {
  if (recordCount <= 0) {
    return;
  }
  safePublish((m) => {
    m.addMetric('DynamoStreamBatchRecordsReceived', MetricUnit.Count, recordCount);
  });
}

/** Records that matched no route and were acked without handler execution. */
export function recordDynamoStreamRecordFiltered(count: number): void {
  if (count <= 0) {
    return;
  }
  safePublish((m) => {
    m.addMetric('DynamoStreamRecordsFiltered', MetricUnit.Count, count);
  });
}

/** @deprecated Use {@link recordConsumerDeliveryDisposition}; kept for `EventConsumer` call sites. */
export function recordConsumerDeadLetter(
  eventType?: string,
  _context?: { retryCount?: number; error?: string }
): void {
  recordConsumerDeliveryDisposition(eventType, 'dead_letter_candidate');
}
