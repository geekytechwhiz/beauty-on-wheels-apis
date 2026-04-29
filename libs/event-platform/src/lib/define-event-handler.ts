import { createEventHandler } from './create-event-handler';
import { getSchemaMeta } from '../core/schema/schema-meta';
import { EventSchemaMeta } from '../core/schema/define-event-schema';
import { z } from 'zod';

export function defineEventHandler<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  handler: (
    event: z.infer<TSchema> & { meta: EventSchemaMeta },
  ) => Promise<void>,
) {
  const { eventType, eventVersion, source } =
    getSchemaMeta(schema);

  return createEventHandler(
    {
      operation: eventType as any,
      eventBridgeSource: source,

      events: [
        {
          name: eventType,
          versions: {
            [eventVersion]: schema,
          },
        },
      ],
    },
    handler,
  );
}
