import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { getConfig } from '@api-hub/observability';
import { isTestRuntime } from '../config/env';

export const WHATSAPP_METRIC = {
  MESSAGES_RECEIVED: 'whatsapp.messages.received',
  MESSAGES_SENT: 'whatsapp.messages.sent',
  MESSAGES_FAILED: 'whatsapp.messages.failed',
  WEBHOOK_FAILED: 'whatsapp.webhook.failed',
  CONVERSATION_STARTED: 'whatsapp.conversation.started',
  CONVERSATION_COMPLETED: 'whatsapp.conversation.completed',
  BOOKING_STARTED: 'whatsapp.booking.started',
  BOOKING_COMPLETED: 'whatsapp.booking.completed',
  BOOKING_FAILED: 'whatsapp.booking.failed',
  META_API_FAILED: 'whatsapp.meta.api.failed',
} as const;

export function recordMetric(name: string): void {
  if (isTestRuntime()) return;
  try {
    const cfg = getConfig();
    const metrics = new Metrics({
      namespace: cfg.metricsNamespace,
      serviceName: cfg.serviceName || 'whatsapp-channel-service',
    });
    metrics.addMetric(name, MetricUnit.Count, 1);
    metrics.publishStoredMetrics();
  } catch {
    // Metrics must not break webhook acknowledgement.
  }
}
