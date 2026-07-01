import { TaskService } from '@api-hub/task-core';
import { createLogger } from '@api-hub/observability';

import { getReminderSchedulerGateway } from '../../../reminder/reminder-scheduler.gateway';
import { mapMetaToCancelRequest } from '../../../reminder/reminder-stream.mapper';
import type { TaskMetaStreamPayload } from '../task-meta-stream.payload';

const logger = createLogger({ service: 'task-service', redactPII: true });
const taskService = new TaskService();

export async function runCancelReminder(
  payload: TaskMetaStreamPayload,
  correlationId?: string,
): Promise<void> {
  const cancelRequest = mapMetaToCancelRequest(payload);

  await getReminderSchedulerGateway().cancel(cancelRequest);

  const persistResult = await taskService.recordReminderCancellation({
    runtimeTaskInstanceId: cancelRequest.runtimeTaskInstanceId,
    reason: cancelRequest.reason,
    correlationId,
  });

  logger.info({
    event: 'reminder_cancel_persisted',
    schedulerJobId: `task-reminder-${cancelRequest.runtimeTaskInstanceId}`,
    runtimeTaskInstanceId: cancelRequest.runtimeTaskInstanceId,
    reason: cancelRequest.reason,
    lookupWritten: persistResult.written,
    correlationId,
  });
}
