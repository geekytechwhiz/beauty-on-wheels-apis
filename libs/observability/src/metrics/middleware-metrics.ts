import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

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
    })
  );
}

/**
 * EMF metrics for middleware pipeline timing (Powertools). Safe to no-op failures so
 * metric publish never masks handler errors.
 */
export function publishMiddlewarePipelineMetrics(options: {
  operation: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  /** Set when `outcome` is `failure` for classification dashboards. */
  errorCode?: string;
  retryable?: boolean;
}): void {
  try {
    const m = createMetricsInstance();
    m.addDimension('operation', options.operation);
    m.addMetric('RequestInvocations', MetricUnit.Count, 1);
    m.addMetric('Latency', MetricUnit.Milliseconds, options.durationMs);
    m.addMetric('Success', MetricUnit.Count, options.outcome === 'success' ? 1 : 0);
    m.addMetric('Failure', MetricUnit.Count, options.outcome === 'failure' ? 1 : 0);
    if (options.outcome === 'failure') {
      if (options.errorCode) {
        m.addDimension('ErrorCode', options.errorCode);
      }
      if (options.retryable !== undefined) {
        m.addDimension('Retryable', options.retryable ? 'true' : 'false');
      }
    }
    m.publishStoredMetrics();
  } catch (error) {
    metricsPublishFailed('middleware_pipeline', error);
  }
}
