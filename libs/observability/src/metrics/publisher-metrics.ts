import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';

import { getConfig } from '../config/config';

function createMetricsInstance(): Metrics {
  const cfg = getConfig();
  return new Metrics({
    namespace: cfg.metricsNamespace,
    serviceName: cfg.serviceName,
  });
}

function safePublish(fn: (m: Metrics) => void): void {
  try {
    const m = createMetricsInstance();
    fn(m);
    m.publishStoredMetrics();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'metrics_publish_failed',
        context: 'event_publisher',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** Emitted when a domain event fails to publish after persistence succeeded. */
export function recordPublishFailure(eventName: string, error?: unknown): void {
  safePublish((m) => {
    m.addDimension('eventName', eventName);
    m.addMetric('PublishFailures', MetricUnit.Count, 1);
    m.addDimension('Error', error instanceof Error ? error.name : 'unknown');
  });
}

/** Successful outbound event publish. */
export function recordPublishSuccess(eventName: string): void {
  safePublish((m) => {
    m.addDimension('eventName', eventName);
    m.addMetric('PublishSuccess', MetricUnit.Count, 1);
  });
}
