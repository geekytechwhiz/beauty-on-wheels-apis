import type { z } from 'zod';

import { EventSchemaError } from './event-schema-error';

/**
 * Minimal shape for per-`eventType` payload checks (envelope events, or HTTP events
 * that set `eventType` / `payload` for the registry).
 */
export type EventWithPayload = {
  eventType?: string;
  payload?: unknown;
} & Record<string, unknown>;

/**
 * Validates a value against an explicit Zod schema.
 */
export function validate<T>(event: unknown, schema: z.ZodType<T>): T {
  const r = schema.safeParse(event);
  if (!r.success) {
    throw new EventSchemaError('Event failed schema validation', r.error);
  }
  return r.data;
}

export type PayloadSchemaRegistry = Partial<Record<string, z.ZodType<unknown>>>;

/**
 * Applies the schema registered for `event.eventType` to `event.payload` when present.
 * Missing or empty `eventType` skips validation. When `eventType` is set, a registered schema
 * is required (strict mode).
 */
export function validatePayloadByEventType(
  event: EventWithPayload,
  registry: PayloadSchemaRegistry,
): EventWithPayload {
  if (typeof event.eventType !== 'string' || !event.eventType) {
    return event;
  }
  const schema = registry[event.eventType];
  if (schema === undefined) {
    throw new Error(`Schema not registered for eventType "${event.eventType}"`);
  }
  const r = schema.safeParse(event.payload);
  if (!r.success) {
    throw new EventSchemaError(
      `Payload validation failed for eventType "${event.eventType}"`,
      r.error,
    );
  }
  return { ...event, payload: r.data };
}
