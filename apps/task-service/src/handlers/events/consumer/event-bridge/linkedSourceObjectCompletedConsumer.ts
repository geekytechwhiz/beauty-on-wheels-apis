import { TaskService } from '@api-hub/task-core';
import { onEvent, TASK_EVENT_OPERATIONS } from '@api-hub/event-platform';

import { buildTaskEventConsumerDeps } from '../../bootstrap/event-consumer-deps';
import { configureEventRuntime } from '../../bootstrap/event-runtime';
import { LinkedSourceObjectCompletedEventSchema } from '../../inbound/linked-source-object-completed.event';
import type { LinkedSourceObjectCompletedPayload } from '../../inbound/linked-source-object-completed.payload';

configureEventRuntime();

const taskService = new TaskService();

export async function runLinkedSourceObjectCompleted(
  payload: LinkedSourceObjectCompletedPayload,
): Promise<void> {
  await taskService.completeLinkedSourceObject(payload);
}

export const handler = onEvent({
  operation: TASK_EVENT_OPERATIONS.ON_LINKED_SOURCE_OBJECT_COMPLETED,
  consumer: buildTaskEventConsumerDeps(),
  events: [
    {
      schema: LinkedSourceObjectCompletedEventSchema,
      handler: async ({ meta: _meta, ...payload }) => {
        await runLinkedSourceObjectCompleted(payload as LinkedSourceObjectCompletedPayload);
      },
    },
  ],
});

export const main = handler;
