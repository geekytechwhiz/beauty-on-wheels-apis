import type { APIGatewayProxyEvent } from 'aws-lambda';
import { InvalidSignatureError } from '../utils/webhookErrors';
import type { CanonicalLabEvent } from '../models/canonicalEvent';
import type { WebhookPayload } from '../models/webhookPayload';
import type { LabWebhookAdapter } from './labWebhook.adapter';

export class RedcliffeWebhookAdapter implements LabWebhookAdapter {
  constructor(private readonly _partnerId: string) {}

  authenticate(req: APIGatewayProxyEvent): void {
    const signature = req.headers?.['x-webhook-signature'] ?? req.headers?.['X-Webhook-Signature'];
    const timestamp = req.headers?.['x-webhook-timestamp'] ?? req.headers?.['X-Webhook-Timestamp'];
    // TODO: validate timestamp (replay window) and signature using partner config secret
    if (!signature && !timestamp) {
      throw new InvalidSignatureError('Missing webhook signature or timestamp');
    }
  }

  getEventId(payload: WebhookPayload): string {
    const id = payload['eventId'] ?? payload['id'] ?? payload['event_id'];
    if (typeof id !== 'string') {
      throw new InvalidSignatureError('Missing or invalid event id in payload');
    }
    return id;
  }

  parseEvent(payload: WebhookPayload): CanonicalLabEvent {
    const eventType = mapRedcliffeEventType(payload['eventType'] ?? payload['event_type']);
    const labOrderId = String(payload['orderId'] ?? payload['order_id'] ?? '');
    const occurredAt =
      typeof payload['occurredAt'] === 'string'
        ? payload['occurredAt']
        : typeof payload['occurred_at'] === 'string'
          ? payload['occurred_at']
          : new Date().toISOString();
    const rawReferenceId = this.getEventId(payload);

    return {
      eventType,
      partnerId: this._partnerId,
      labOrderId,
      occurredAt,
      rawReferenceId,
    };
  }
}

function mapRedcliffeEventType(value: unknown): CanonicalLabEvent['eventType'] {
  const s = typeof value === 'string' ? value.toUpperCase() : '';
  const map: Record<string, CanonicalLabEvent['eventType']> = {
    SAMPLE_COLLECTED: 'SAMPLE_COLLECTED',
    SAMPLE_RECEIVED: 'SAMPLE_RECEIVED',
    REPORT_READY: 'REPORT_READY',
    BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  };
  if (map[s]) return map[s];
  return 'REPORT_READY';
}

export function createRedcliffeAdapter(partnerId: string): LabWebhookAdapter {
  return new RedcliffeWebhookAdapter(partnerId);
}
