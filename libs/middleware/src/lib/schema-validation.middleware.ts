import type { z } from 'zod';
import { BaseError } from '@api-hub/utils';

import { EventSchemaError } from './event-schema/event-schema-error';

export function schemaValidationMiddleware(options: {
  schema?: z.ZodType<unknown>;
}) {
  const { schema } = options;

  return async ({ event, next }: any) => {
    if (!schema) return next();

    let body = event?.body;

    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        throw new BaseError(
          'Invalid JSON body',
          400,
          'INVALID_JSON',
          [{ message: 'Invalid JSON body' }],
          { retryable: false },
        );
      }
    }

    const result = schema.safeParse(body);

    if (!result.success) {
      throw new EventSchemaError(
        'API request body failed schema validation',
        result.error
      );
    }

    // 🔥 ensure downstream gets correct value
    event.body = result.data;

    return next();
  };
}