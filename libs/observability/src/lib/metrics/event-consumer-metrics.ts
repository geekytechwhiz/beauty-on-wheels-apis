import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';

import { requireServiceName } from '../service-name.js';
import { logger } from '../logger/logger.js';

let metricsInstance: Metrics | undefined;

function getMetrics(): Metrics {
  if (!metricsInstance) {
    metricsInstance = new Metrics({
      namespace: process.env.POWERTOOLS_METRICS_NAMESPACE ?? 'ApiHub',
      serviceName: requireServiceName(),
    });
  }
  return metricsInstance;
}

function addEventTypeDimension(m: Metrics, eventType?: string): void {
  if (typeof eventType === 'string' && eventType.length > 0) {
    m.addDimension('eventType', eventType);
  }
}

function safePublish(fn: (m: Metrics) => void): void {
  try {
    const m = getMetrics();
    fn(m);
    m.publishStoredMetrics();
  } catch (error) {
    logger.warn('Failed to publish event consumer metrics', {
      event: 'event_consumer_metrics_publish_failed',
      err: error,
    });
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
export function recordConsumerFailure(eventType?: string): void {
  safePublish((m) => {
    addEventTypeDimension(m, eventType);
    m.addMetric('ProcessingFailures', MetricUnit.Count, 1);
  });
}

/**
 * Consumer classified the outcome as a dead-letter candidate (DLQ policy is still external).
 */
export function recordConsumerDeadLetter(eventType?: string): void {
  safePublish((m) => {
    addEventTypeDimension(m, eventType);
    m.addMetric('DlqCount', MetricUnit.Count, 1);
  });
}

/**
 * A handler attempt failed and a retry was scheduled (before backoff). One increment per retry, not per message.
 */
export function recordConsumerRetry(eventType?: string): void {
  safePublish((m) => {
    addEventTypeDimension(m, eventType);
    m.addMetric('Retries', MetricUnit.Count, 1);
  });
}
