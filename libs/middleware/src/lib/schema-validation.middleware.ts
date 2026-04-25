import type { z } from 'zod';

import { EventSchemaError } from './event-schema/event-schema-error';
import type { Middleware, MiddlewarePipelineEvent } from './types';

/**
 * **HTTP API only:** validates the full Lambda `event` (e.g. `APIGatewayProxyEvent`) when
 * a Zod schema is provided. Omitted or absent `schema` → no-op.
 * Domain `eventType` + `payload` validation for platform events lives in `@api-hub/event-platform`.
 */
export function schemaValidationMiddleware<
  TResult = unknown,
  TContext = unknown,
>(options: {
  schema?: z.ZodType<unknown>;
}): Middleware<MiddlewarePipelineEvent, TResult, TContext> {
  const { schema } = options;
  if (schema === undefined) {
    return async ({ next }) => next();
  }

  return async ({ event, next }) => {
    const r = schema.safeParse(event);
    if (!r.success) {
      throw new EventSchemaError('API request event failed schema validation', r.error);
    }
    return next();
  };
}
