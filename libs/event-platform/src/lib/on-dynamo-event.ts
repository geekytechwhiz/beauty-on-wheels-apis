import type { z } from 'zod';

import { getSchemaMeta } from '../core/schema/schema-meta';
import type { DynamoStreamEventNameFilter, DynamoStreamRoute } from '../dynamo-stream/map-dynamo-stream-record';
import type { BaseEvent } from '../typings/base-event.types';

import {
  createDynamoStreamHandler,
  type CreateDynamoStreamHandlerOperationName,
} from './create-dynamo-stream-handler';

/**
 * Single-schema DynamoDB Streams handler (table / `eventName` filters optional).
 * Uses {@link createDynamoStreamHandler} internally — same middleware and orchestration stack.
 */
export function onDynamoEvent<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  handler: (input: z.infer<TSchema> & { meta: BaseEvent['meta'] }) => Promise<void>,
  route?: {
    table?: DynamoStreamRoute['table'];
    eventName?: DynamoStreamEventNameFilter;
  },
): ReturnType<typeof createDynamoStreamHandler> {
  const meta = getSchemaMeta(schema);
  const operation =
    `${meta.source}.processed` as CreateDynamoStreamHandlerOperationName;

  return createDynamoStreamHandler({
    operation,
    events: [
      {
        table: route?.table,
        eventName: route?.eventName ?? (['INSERT', 'MODIFY', 'REMOVE'] as const),
        schema,
        handler: async (input, _ctx) => {
          await handler(
            input as z.infer<TSchema> & { meta: BaseEvent['meta'] },
          );
        },
      },
    ],
  });
}
