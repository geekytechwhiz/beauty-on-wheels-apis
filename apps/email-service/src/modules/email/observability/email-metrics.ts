import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';

export const EMAIL_METRIC = {
  EVENTS_CONSUMED: 'EventsConsumed',
  EMAILS_REQUESTED: 'EmailsRequested',
  VALIDATION_FAILURES: 'ValidationFailures',
  TEMPLATE_NOT_FOUND: 'TemplateNotFound',
  PARAMETER_VALIDATION_FAILURES: 'ParameterValidationFailures',
  RENDERING_FAILURES: 'RenderingFailures',
  SES_SUCCESS: 'SesSuccess',
  SES_FAILURE: 'SesFailure',
  DUPLICATE_SKIPS: 'DuplicateSkips',
  DELIVERY_FAILURES: 'DeliveryFailures',
  BOUNCE: 'Bounce',
  COMPLAINT: 'Complaint',
  PROCESSING_LATENCY: 'ProcessingLatency',
} as const;

export type EmailMetricName = (typeof EMAIL_METRIC)[keyof typeof EMAIL_METRIC];

export interface EmailMetrics {
  count(name: EmailMetricName): void;
  latency(milliseconds: number): void;
}

export class PowertoolsEmailMetrics implements EmailMetrics {
  count(name: EmailMetricName): void {
    this.publish((metrics) => {
      metrics.addMetric(name, MetricUnit.Count, 1);
    });
  }

  latency(milliseconds: number): void {
    this.publish((metrics) => {
      metrics.addMetric(EMAIL_METRIC.PROCESSING_LATENCY, MetricUnit.Milliseconds, milliseconds);
    });
  }

  private publish(record: (metrics: Metrics) => void): void {
    try {
      const metrics = new Metrics({
        namespace: process.env.METRICS_NAMESPACE || 'ApiHub',
        serviceName: process.env.SERVICE_NAME || 'bw-email-service',
      });
      record(metrics);
      metrics.publishStoredMetrics();
    } catch {
      // Metrics must not fail email delivery.
    }
  }
}

export class RecordingEmailMetrics implements EmailMetrics {
  readonly counts: EmailMetricName[] = [];
  readonly latencies: number[] = [];

  count(name: EmailMetricName): void {
    this.counts.push(name);
  }

  latency(milliseconds: number): void {
    this.latencies.push(milliseconds);
  }
}
