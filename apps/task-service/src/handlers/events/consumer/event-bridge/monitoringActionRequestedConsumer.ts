import { TaskService } from '@api-hub/task-core';
import { onEvent, TASK_EVENT_OPERATIONS } from '@api-hub/event-platform';

import { buildTaskEventConsumerDeps } from '../../bootstrap/event-consumer-deps';
import { configureEventRuntime } from '../../bootstrap/event-runtime';
import type { MonitoringActionRequestedPayload } from '../../inbound/monitoring-action-requested.payload';
import { MonitoringActionRequestedEventSchema } from '../../inbound/monitoring-action-requested.event';

configureEventRuntime();

const taskService = new TaskService();

export async function runMonitoringActionRequested(
  payload: MonitoringActionRequestedPayload,
): Promise<void> {
  await taskService.createMonitoringAction(payload);
}

export const handler = onEvent({
  operation: TASK_EVENT_OPERATIONS.ON_MONITORING_ACTION_REQUESTED,
  consumer: buildTaskEventConsumerDeps(),
  events: [
    {
      schema: MonitoringActionRequestedEventSchema,
      handler: async ({ meta: _meta, ...payload }) => {
        await runMonitoringActionRequested(payload as MonitoringActionRequestedPayload);
      },
    },
  ],
});

export const main = handler;
