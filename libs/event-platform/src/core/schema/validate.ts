import type { z } from 'zod';
import { EventSchemaError } from "@api-hub/middleware";
import { BaseEvent } from '../../typings/base-event.types';

/**
 * Validates a value against an explicit Zod schema (e.g. full {@link BaseEvent} or payload).
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
 * Unknown `eventType` entries skip validation.
 */
export function validatePayloadByEventType(
  event: BaseEvent,
  registry: PayloadSchemaRegistry,
): BaseEvent {
  const schema = registry[event.eventType];
  if (schema === undefined) {
    return event;
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
