import type { Middleware } from './types';
import type { EventWithPayload } from './event-schema/validate';
import { validatePayloadByEventType, type PayloadSchemaRegistry } from './event-schema/validate';

/**
 * Validates `event.payload` using `validatePayloadByEventType` and a
 * per-`eventType` Zod registry. On failure, throws `EventSchemaError` (wraps `ZodError`).
 *
 * Merges the validated payload onto the same `event` object so downstream
 * handlers receive parsed/normalized `payload` without re-validating.
 */
export function schemaValidationMiddleware<
  TResult = unknown,
  TContext = unknown,
>(options: {
  payloadSchemas: PayloadSchemaRegistry;
}): Middleware<EventWithPayload, TResult, TContext> {
  const { payloadSchemas } = options;

  return async ({ event, next }) => {
    const e = event as EventWithPayload;
    const validated = validatePayloadByEventType(e, payloadSchemas);
    Object.assign(e, validated);
    return next();
  };
}
