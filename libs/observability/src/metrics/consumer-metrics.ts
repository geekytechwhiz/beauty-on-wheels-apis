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

/** @deprecated Use {@link recordConsumerDeliveryDisposition}; kept for `EventConsumer` call sites. */
export function recordConsumerDeadLetter(
  eventType?: string,
  _context?: { retryCount?: number; error?: string }
): void {
  recordConsumerDeliveryDisposition(eventType, 'dead_letter_candidate');
}
