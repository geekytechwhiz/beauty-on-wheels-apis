import { getReminderSchedulerGateway } from '../../../reminder/reminder-scheduler.gateway';
import { mapMetaToRegisterRequest } from '../../../reminder/reminder-stream.mapper';
import type { TaskMetaStreamPayload } from '../task-meta-stream.payload';

export async function processRegisterReminder(
  payload: TaskMetaStreamPayload,
  correlationId?: string,
): Promise<void> {
  await getReminderSchedulerGateway().register(
    mapMetaToRegisterRequest(payload, correlationId),
  );
}
