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
    }),
  );
}

function safePublish(fn: (m: Metrics) => void): void {
  try {
    const m = createMetricsInstance();
    fn(m);
    m.publishStoredMetrics();
  } catch (error) {
    metricsPublishFailed('realtime_aggregation', error);
  }
}

/** Emitted when aggregation consumer receives events in a batch. */
export function recordAggregationEventsReceived(count: number): void {
  safePublish((m) => {
    m.addMetric('aggregationEventsReceived', MetricUnit.Count, count);
  });
}

/** Emitted when aggregation groups are created from a batch. */
export function recordAggregationGroupsCreated(count: number): void {
  safePublish((m) => {
    m.addMetric('aggregationGroupsCreated', MetricUnit.Count, count);
  });
}

/** Emitted when aggregated messages are published to RealtimePublisher. */
export function recordAggregationEventsPublished(count: number): void {
  safePublish((m) => {
    m.addMetric('aggregationEventsPublished', MetricUnit.Count, count);
  });
}
