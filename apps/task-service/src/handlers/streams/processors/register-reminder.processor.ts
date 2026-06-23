import { TaskService } from '@api-hub/task-core';
import { createLogger } from '@api-hub/observability';

import { getQuietHoursProvider } from '../../../reminder/quiet-hours.provider';
import { getReminderSchedulerGateway } from '../../../reminder/reminder-scheduler.gateway';
import {
  mapMetaToRegisterRequest,
  primaryReminderChannel,
} from '../../../reminder/reminder-stream.mapper';
import type { TaskMetaStreamPayload } from '../task-meta-stream.payload';

const logger = createLogger({ service: 'task-service', redactPII: true });
const taskService = new TaskService();

export async function processRegisterReminder(
  payload: TaskMetaStreamPayload,
  correlationId?: string,
): Promise<void> {
  const quietWindow = await getQuietHoursProvider().getForPatient({
    patientId: payload.patientId,
    orgId: payload.orgId,
  });

  if (!primaryReminderChannel(payload)) {
    logger.info({
      event: 'reminder_register_skipped_mapping',
      reason: 'noChannel',
      runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
      orgId: payload.orgId,
      patientId: payload.patientId,
      correlationId,
    });
    return;
  }

  const request = mapMetaToRegisterRequest(payload, correlationId, quietWindow);
  if (!request) {
    logger.info({
      event: 'reminder_register_skipped_mapping',
      reason: 'noScheduleAnchor',
      runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
      orgId: payload.orgId,
      patientId: payload.patientId,
      correlationId,
    });
    return;
  }

  const registerResult = await getReminderSchedulerGateway().register(request);
  if (registerResult.outcome === 'skipped') {
    logger.warn({
      event: 'reminder_register_skipped_past',
      reason: registerResult.reason,
      runtimeTaskInstanceId: request.runtimeTaskInstanceId,
      patientId: request.patientId,
      orgId: request.orgId,
      scheduledAt: request.scheduledAt,
      correlationId,
    });
    return;
  }

  const persistResult = await taskService.recordReminderRegistration({
    runtimeTaskInstanceId: request.runtimeTaskInstanceId,
    scheduledAt: registerResult.scheduledAt,
    channel: request.channel,
    schedulerJobId: registerResult.schedulerJobId,
    correlationId,
  });

  logger.info({
    event: 'reminder_register_persisted',
    outcome: registerResult.outcome,
    schedulerJobId: registerResult.schedulerJobId,
    runtimeTaskInstanceId: request.runtimeTaskInstanceId,
    scheduledAt: registerResult.scheduledAt,
    lookupWritten: persistResult.written,
    correlationId,
  });
}
