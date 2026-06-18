import { createDynamoStreamHandler } from '@api-hub/event-platform';

import { buildTaskStreamConsumerDeps } from './bootstrap/stream-consumer-deps';
import { processCancelReminder } from './processors/cancel-reminder.processor';
import { TaskMetaStreamPayloadSchema } from './task-meta-stream.schema';
import type { TaskMetaStreamPayload } from './task-meta-stream.payload';

export const handler = createDynamoStreamHandler({
  operation: 'task-service.reminder.cancel',
  consumer: buildTaskStreamConsumerDeps(),
  events: [
    {
      table: 'task-service',
      eventName: ['MODIFY'],
      schema: TaskMetaStreamPayloadSchema,
      handler: async (input) => {
        const { meta: _meta, ...payload } = input;
        await processCancelReminder(payload as TaskMetaStreamPayload);
      },
    },
  ],
});

export const main = handler;
