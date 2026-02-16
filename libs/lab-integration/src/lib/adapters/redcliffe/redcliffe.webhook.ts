import { isCanonicalLabEventType } from '@api-hub/integration-events';
import type { CanonicalLabEventType } from '@api-hub/integration-events';
import type { CanonicalLabWebhookResult, LabWebhookAdapter, WebhookParseOptions } from '../base/webhook.types';

/** Redcliffe webhook payload shape (e.g. booking_id, status). */
interface RedcliffeWebhookPayload {
  booking_id?: string | number;
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

export class RedcliffeWebhookAdapter implements LabWebhookAdapter {
  parsePayload(body: unknown, options?: WebhookParseOptions): CanonicalLabWebhookResult | null {
    if (!body || typeof body !== 'object') return null;
    const payload = body as RedcliffeWebhookPayload;
    const status = payload.status;
    if (!status || typeof status !== 'string') return null;

    const normalized = status.toLowerCase().trim().replace(/\s+/g, '_');
    const eventType = STATUS_TO_CANONICAL[normalized] ?? (isCanonicalLabEventType(normalized) ? (normalized as CanonicalLabEventType) : null);
    if (!eventType) return null;

    const bookingId = payload.booking_id != null ? String(payload.booking_id) : undefined;
    const eventId = bookingId ?? (payload.id != null ? String(payload.id) : undefined) ?? `redcliffe-${Date.now()}`;

    return {
      eventId,
      eventType,
      detail: {
        partnerId: 'redcliffe',
        bookingId,
        status: payload.status,
        ...payload,
      },
      partnerId: 'redcliffe',
    };
  }
}
