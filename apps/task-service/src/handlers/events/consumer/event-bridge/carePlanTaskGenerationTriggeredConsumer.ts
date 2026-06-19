import { TaskService } from '@api-hub/task-core';
import { onEvent, TASK_EVENT_OPERATIONS } from '@api-hub/event-platform';

import { buildTaskEventConsumerDeps } from '../../bootstrap/event-consumer-deps';
import { configureEventRuntime } from '../../bootstrap/event-runtime';
import { CarePlanTaskGenerationTriggeredEventSchema } from '../../inbound/care-plan-task-generation-triggered.event';
import type { CarePlanTaskGenerationTriggeredPayload } from '../../inbound/care-plan-task-generation-triggered.payload';
import { mapIngestPayloadToGenerateCarePlanTasks } from '../../mappers/task-event-ingest.mapper';

configureEventRuntime();

const taskService = new TaskService();

export async function processCarePlanTaskGenerationTriggered(
  payload: CarePlanTaskGenerationTriggeredPayload,
): Promise<void> {
  await taskService.generateCarePlanTasks(mapIngestPayloadToGenerateCarePlanTasks(payload));
}

export const handler = onEvent({
  operation: TASK_EVENT_OPERATIONS.ON_CARE_PLAN_TASK_GENERATION_TRIGGERED,
  consumer: buildTaskEventConsumerDeps(),
  events: [
    {
      schema: CarePlanTaskGenerationTriggeredEventSchema,
      handler: async (input) => {
        const { meta: _meta, ...payload } = input;
        await processCarePlanTaskGenerationTriggered(payload as CarePlanTaskGenerationTriggeredPayload);
      },
    },
  ],
});

export const main = handler;
