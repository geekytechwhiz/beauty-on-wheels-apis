import { createDynamoStreamHandler } from '@api-hub/event-platform';

import { buildTaskStreamConsumerDeps } from './bootstrap/stream-consumer-deps';
import { runRegisterReminder } from './processors/register-reminder.processor';
import { TaskMetaStreamPayloadSchema } from './task-meta-stream.schema';
import type { TaskMetaStreamPayload } from './task-meta-stream.payload';

export const handler = createDynamoStreamHandler({
  operation: 'task-service.reminder.register',
  consumer: buildTaskStreamConsumerDeps(),
  events: [
    {
      table: 'task-service',
      eventName: ['INSERT', 'MODIFY'],
      schema: TaskMetaStreamPayloadSchema,
      handler: async (input) => {
        const { meta, ...payload } = input;
        await runRegisterReminder(payload as TaskMetaStreamPayload, meta.correlationId);
      },
    },
  ],
});

export const main = handler;
