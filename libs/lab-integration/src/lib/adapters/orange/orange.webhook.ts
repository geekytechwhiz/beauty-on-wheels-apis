import * as crypto from 'crypto';
import { isCanonicalLabEventType,CanonicalLabEventType } from '../../types/canonicalLabEventTypes';     
 
import type { CanonicalLabWebhookResult, LabWebhookAdapter, WebhookParseOptions } from '../base/webhook.types';

/**
 * Orange Health webhook payload structure:
 * {
 *   event: string;        // Format: "object.verb" (e.g., "order.created")
 *   contains: string[];   // Array of keys present in payload
 *   payload: object;      // Actual event data
 * }
 */
interface OrangeWebhookBody {
  event?: string;
  contains?: string[];
  payload?: {
    id?: string | number;
    orderId?: string | number;
    order?: {
      id?: string | number;
      orderId?: string | number;
    };
    partnerReferenceId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Map Orange Health events to canonical event types.
 * Orange events follow format: "object.verb" (e.g., "order.created", "task.completed")
 * All values are validated at runtime using isCanonicalLabEventType.
 */
const ORANGE_EVENT_TO_CANONICAL: Record<string, CanonicalLabEventType> = {
  'order.created': 'ORDER_CREATED',
  'task.confirmed': 'ORDER_CONFIRMED',
  'task.assigned': 'TASK_ASSIGNED',
  'task.accepted': 'TASK_ACCEPTED',
  'task.started': 'TASK_STARTED',
  'task.in_progress': 'SAMPLE_COLLECTED',
  'task.completed': 'SAMPLE_COLLECTED',
  'test.completed_not_sent': 'REPORT_READY',
  'test.completed_sent': 'REPORT_READY',
  'order.completed': 'ORDER_COMPLETED',
  'order.cancelled': 'BOOKING_CANCELLED',
  'task.deleted': 'TASK_DELETED',
};

export class OrangeWebhookAdapter implements LabWebhookAdapter {
  /**
   * Validate Orange Health webhook signature using HMAC SHA256.
   * @param rawBody - Raw request body as string (must be stringified with 0 whitespaces)
   * @param signature - Signature from X-OH-Signature header
   * @param secretKey - Webhook secret key
   * @returns true if signature is valid, false otherwise
   */
  validateSignature(rawBody: string, signature: string, secretKey: string): boolean {
    try {
      const key = Buffer.from(secretKey, 'utf-8');
      const hmac = crypto.createHmac('sha256', key);
      hmac.update(rawBody);
      const expectedSignature = hmac.digest('hex');
      // Compare case-insensitively as headers may be normalized
      return expectedSignature.toLowerCase() === signature.toLowerCase();
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract orderId from Orange Health payload.
   * OrderId location varies by event type:
   * - payload.id
   * - payload.orderId
   * - payload.order.id
   * - payload.order.orderId
   */
  private extractOrderId(payload: OrangeWebhookBody['payload']): string | undefined {
    if (!payload) return undefined;

    // Try direct fields first
    if (payload.id != null) return String(payload.id);
    if (payload.orderId != null) return String(payload.orderId);

    // Try nested order object
    if (payload.order && typeof payload.order === 'object') {
      if (payload.order.id != null) return String(payload.order.id);
      if (payload.order.orderId != null) return String(payload.order.orderId);
    }

    return undefined;
  }

  /**
   * Parse Orange Health webhook payload into canonical format.
   */
  parsePayload(body: unknown, options?: WebhookParseOptions): CanonicalLabWebhookResult | null {
    if (!body || typeof body !== 'object') return null;

    const orangeBody = body as OrangeWebhookBody;

    // Validate Orange Health structure
    if (!orangeBody.event || typeof orangeBody.event !== 'string') {
      return null;
    }

    // Validate signature if provided
    if (options?.secretKey && options?.rawBody) {
      const signature = options.headers?.['x-oh-signature'] || options.headers?.['X-OH-Signature'];
      if (signature) {
        const isValid = this.validateSignature(options.rawBody, signature, options.secretKey);
        if (!isValid) {
          // Return null to indicate invalid payload (will be handled by service)
          return null;
        }
      }
    }

    // Map Orange event to canonical event type
    const normalizedEvent = orangeBody.event.toLowerCase().trim();
    const mappedEventType = ORANGE_EVENT_TO_CANONICAL[normalizedEvent];
    
    // Validate that the mapped event type is a valid canonical event type
    const eventType = mappedEventType && isCanonicalLabEventType(mappedEventType) 
      ? mappedEventType 
      : null;

    if (!eventType) {
      // Unknown event type or invalid mapping - don't process
      return null;
    }

    // Extract orderId from payload
    const orderId = this.extractOrderId(orangeBody.payload);

    // Extract eventId from header (x-oh-event-id) or generate fallback
    const eventId =
      options?.headers?.['x-oh-event-id'] ||
      options?.headers?.['X-OH-Event-ID'] ||
      orderId ||
      `orange-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Build detail object with full payload for downstream processing
    const detail: Record<string, unknown> = {
      partnerId: 'orange',
      orderId,
      event: orangeBody.event,
      contains: orangeBody.contains || [],
      ...orangeBody.payload,
    };

    // Add partnerReferenceId if present
    if (orangeBody.payload?.partnerReferenceId) {
      detail.partnerReferenceId = orangeBody.payload.partnerReferenceId;
    }

    return {
      eventId,
      eventType,
      detail,
      partnerId: 'orange',
    };
  }
}
