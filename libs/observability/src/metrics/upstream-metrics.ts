import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';

import { getConfig } from '../config/config.js';

function createMetricsInstance(): Metrics {
  const cfg = getConfig();
  return new Metrics({
    namespace: cfg.metricsNamespace,
    serviceName: cfg.serviceName,
  });
}

function metricsPublishFailed(context: string, err: unknown): void {
  // eslint-disable-next-line no-console
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
    metricsPublishFailed('upstream', error);
  }
}

/** Emitted when an outbound HTTP client retries a dependency call (one count per retry attempt). */
export function recordUpstreamRetryAttempts(
  dependency: string,
  attempts: number,
): void {
  if (attempts <= 0) return;
  safePublish((m) => {
    m.addDimension('dependency', dependency);
    m.addMetric('UpstreamRetryAttempts', MetricUnit.Count, attempts);
  });
}
