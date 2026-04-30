import { createEventHandler } from './create-event-handler';
import { getSchemaMeta } from '../core/schema/schema-meta';
import { EventSchemaMeta } from '../core/schema/define-event';
import { z } from 'zod';

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
    events: [{ schema, handler }],
  });
}
