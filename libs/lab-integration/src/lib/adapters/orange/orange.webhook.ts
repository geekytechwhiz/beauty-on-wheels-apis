import { isCanonicalLabEventType } from '@api-hub/integration-events';
import type { CanonicalLabEventType } from '@api-hub/integration-events';
import type { CanonicalLabWebhookResult, LabWebhookAdapter } from '../base/webhook.types';

/** Orange Health webhook payload shape (e.g. orderId, status). */
interface OrangeWebhookPayload {
  orderId?: string;
  id?: string;
  status?: string;
  [key: string]: unknown;
}

const STATUS_TO_CANONICAL: Record<string, CanonicalLabEventType> = {
  sample_collected: 'SAMPLE_COLLECTED',
  sample_received: 'SAMPLE_RECEIVED',
  report_ready: 'REPORT_READY',
  report_available: 'REPORT_READY',
  cancelled: 'BOOKING_CANCELLED',
  booking_cancelled: 'BOOKING_CANCELLED',
};

export class OrangeWebhookAdapter implements LabWebhookAdapter {
  parsePayload(body: unknown): CanonicalLabWebhookResult | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as OrangeWebhookPayload;
    const status = payload.status;
    if (!status || typeof status !== 'string') return null;

    const normalized = status.toLowerCase().trim().replace(/\s+/g, '_');
    const eventType = STATUS_TO_CANONICAL[normalized] ?? (isCanonicalLabEventType(normalized) ? (normalized as CanonicalLabEventType) : null);
    if (!eventType) return null;

    const orderId = payload.orderId ?? payload.id;
    const eventId = orderId != null ? String(orderId) : `orange-${Date.now()}`;

    return {
      eventId,
      eventType,
      detail: {
        partnerId: 'orange',
        orderId,
        status: payload.status,
        ...payload,
      },
      partnerId: 'orange',
    };
  }
}
