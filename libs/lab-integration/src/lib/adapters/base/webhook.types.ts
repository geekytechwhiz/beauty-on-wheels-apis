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
 * Webhook headers that may be required for validation and idempotency.
 */
export interface WebhookHeaders {
  'x-oh-signature'?: string;
  'x-oh-event-id'?: string;
  'X-OH-Signature'?: string;
  'X-OH-Event-ID'?: string;
  [key: string]: string | undefined;
}

/**
 * Options passed to webhook adapter for parsing and validation.
 */
export interface WebhookParseOptions {
  headers?: WebhookHeaders;
  rawBody?: string; // Raw body string for signature validation
  secretKey?: string; // Secret key for signature validation
}

/**
 * Adapter for parsing partner-specific lab webhook payloads into canonical event shape.
 * Each partner (Redcliffe, Orange, etc.) implements this to map their payload to
 * CanonicalLabWebhookResult.
 */
export interface LabWebhookAdapter {
  /**
   * Parse raw webhook body into canonical result.
   * @param body - Parsed JSON body
   * @param options - Optional headers, raw body, and secret key for validation
   * @returns CanonicalLabWebhookResult or null if payload is invalid/ignorable
   */
  parsePayload(body: unknown, options?: WebhookParseOptions): CanonicalLabWebhookResult | null;

  /**
   * Validate webhook signature (if required by partner).
   * @param rawBody - Raw request body as string
   * @param signature - Signature from header
   * @param secretKey - Secret key for validation
   * @returns true if signature is valid, false otherwise
   */
  validateSignature?(rawBody: string, signature: string, secretKey: string): boolean;
}
