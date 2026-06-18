import { createDynamoStreamHandler, TASK_REMINDER_STREAM_OPERATIONS } from '@api-hub/event-platform';

import { buildTaskStreamConsumerDeps } from './bootstrap/stream-consumer-deps';
import { processRegisterReminder } from './processors/register-reminder.processor';
import { TaskMetaStreamPayloadSchema } from './task-meta-stream.schema';
import type { TaskMetaStreamPayload } from './task-meta-stream.payload';

export const handler = createDynamoStreamHandler({
  operation: TASK_REMINDER_STREAM_OPERATIONS.REGISTER,
  consumer: buildTaskStreamConsumerDeps(),
  events: [
    {
      table: 'task-service',
      eventName: ['INSERT', 'MODIFY'],
      schema: TaskMetaStreamPayloadSchema,
      handler: async (input) => {
        const { meta, ...payload } = input;
        await processRegisterReminder(payload as TaskMetaStreamPayload, meta.correlationId);
      },
    },
  ],
});

export const main = handler;
