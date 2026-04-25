import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

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

/**
 * EMF metrics for middleware pipeline timing (Powertools). Safe to no-op failures so
 * metric publish never masks handler errors.
 */
export function publishMiddlewarePipelineMetrics(options: {
  operation: string;
  durationMs: number;
  outcome: 'success' | 'failure';
}): void {
  try {
    const m = getMetrics();
    m.addDimension('operation', options.operation);
    m.addMetric('RequestInvocations', MetricUnit.Count, 1);
    m.addMetric('Latency', MetricUnit.Milliseconds, options.durationMs);
    m.addMetric('Success', MetricUnit.Count, options.outcome === 'success' ? 1 : 0);
    m.addMetric('Failure', MetricUnit.Count, options.outcome === 'failure' ? 1 : 0);
    m.publishStoredMetrics();
  } catch (error) {
    logger.warn('Failed to publish middleware pipeline metrics', {
      event: 'middleware_metrics_publish_failed',
      operation: options.operation,
      err: error,
    });
  }
}
