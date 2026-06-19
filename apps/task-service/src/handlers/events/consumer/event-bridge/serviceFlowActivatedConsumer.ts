import { TaskService } from '@api-hub/task-core';
import { onEvent, TASK_EVENT_OPERATIONS } from '@api-hub/event-platform';

import { buildTaskEventConsumerDeps } from '../../bootstrap/event-consumer-deps';
import { configureEventRuntime } from '../../bootstrap/event-runtime';
import { ServiceFlowActivatedEventSchema } from '../../inbound/service-flow-activated.event';
import type { ServiceFlowActivatedPayload } from '../../inbound/service-flow-activated.payload';
import { mapIngestPayloadToCreateRuntimeTask } from '../../mappers/task-event-ingest.mapper';

configureEventRuntime();

const taskService = new TaskService();

export async function processServiceFlowActivated(payload: ServiceFlowActivatedPayload): Promise<void> {
  await taskService.createRuntimeTask(mapIngestPayloadToCreateRuntimeTask(payload));
}

export const handler = onEvent({
  operation: TASK_EVENT_OPERATIONS.ON_SERVICE_FLOW_ACTIVATED,
  consumer: buildTaskEventConsumerDeps(),
  events: [
    {
      schema: ServiceFlowActivatedEventSchema,
      handler: async (input) => {
        const { meta: _meta, ...payload } = input;
        await processServiceFlowActivated(payload as ServiceFlowActivatedPayload);
      },
    },
  ],
});

export const main = handler;
