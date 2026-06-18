import { getReminderSchedulerGateway } from '../../../reminder/reminder-scheduler.gateway';
import { mapMetaToCancelRequest } from '../../../reminder/reminder-stream.mapper';
import type { TaskMetaStreamPayload } from '../task-meta-stream.payload';

export async function processCancelReminder(payload: TaskMetaStreamPayload): Promise<void> {
  await getReminderSchedulerGateway().cancel(mapMetaToCancelRequest(payload));
}
