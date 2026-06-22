import { getQuietHoursProvider } from '../../../reminder/quiet-hours.provider';
import { getReminderSchedulerGateway } from '../../../reminder/reminder-scheduler.gateway';
import { mapMetaToRegisterRequest } from '../../../reminder/reminder-stream.mapper';
import type { TaskMetaStreamPayload } from '../task-meta-stream.payload';

export async function processRegisterReminder(
  payload: TaskMetaStreamPayload,
  correlationId?: string,
): Promise<void> {
  const quietWindow = await getQuietHoursProvider().getForPatient({
    patientId: payload.patientId,
    orgId: payload.orgId,
  });

  const request = mapMetaToRegisterRequest(payload, correlationId, quietWindow);

  if (!request) {
    return;
  }

  await getReminderSchedulerGateway().register(request);
}
