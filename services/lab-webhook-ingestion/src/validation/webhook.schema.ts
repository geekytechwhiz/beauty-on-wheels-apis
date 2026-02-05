import { z } from 'zod';

/**
 * Base webhook payload schema: must be a JSON object.
 * Partner-specific validation is done in adapters; reject non-objects and unknown top-level shape when needed.
 */
export const webhookPayloadSchema = z.record(z.string(), z.unknown());

export type WebhookPayloadSchema = z.infer<typeof webhookPayloadSchema>;
