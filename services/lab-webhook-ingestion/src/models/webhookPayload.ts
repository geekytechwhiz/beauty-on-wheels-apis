/**
 * Generic webhook payload (partner-specific payloads extend or use unknown).
 * Used for Zod validation and adapter input.
 */
export type WebhookPayload = Record<string, unknown>;
