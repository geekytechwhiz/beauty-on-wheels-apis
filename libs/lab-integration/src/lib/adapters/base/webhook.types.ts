import type { CanonicalLabEventType } from '@api-hub/integration-events';

/**
 * Canonical result of parsing an inbound lab webhook payload.
 * Used for idempotency key and for publishing to EventBridge.
 */
export interface CanonicalLabWebhookResult {
  eventId: string;
  eventType: CanonicalLabEventType;
  detail: Record<string, unknown>;
  partnerId: string;
}

/**
 * Adapter for parsing partner-specific lab webhook payloads into canonical event shape.
 * Each partner (Redcliffe, Orange, etc.) implements this to map their payload to
 * CanonicalLabWebhookResult.
 */
export interface LabWebhookAdapter {
  /**
   * Parse raw webhook body into canonical result.
   * @returns CanonicalLabWebhookResult or null if payload is invalid/ignorable
   */
  parsePayload(body: unknown): CanonicalLabWebhookResult | null;
}
