 
import { getSchemaMeta } from '../core/schema/schema-meta';
import { EventSchemaMeta } from '../core/schema/define-event';
import { z } from 'zod';
import { createEventHandler } from './create-event-handler';

export function onEvent<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  handler: (input: {
    payload: z.infer<TSchema>;
    meta: EventSchemaMeta;
  }) => Promise<void>,
) {
  const { eventType } = getSchemaMeta(schema);

  return createEventHandler({
    operation: eventType as any,
    events: [
      {
        schema,
        handler: async (input, _context) => {
          const { meta, ...payload } = input as {
            meta: EventSchemaMeta;
          } & z.infer<TSchema>;

          await handler({
            payload: payload as z.infer<TSchema>,
            meta,
          });
        },
      },
    ],
  });
}
