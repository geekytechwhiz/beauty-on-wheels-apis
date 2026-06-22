import { TaskService, isInQuietHours } from '@api-hub/task-core';

import { getNotificationGateway } from '../../reminder/notification.gateway';
import { getQuietHoursProvider } from '../../reminder/quiet-hours.provider';
import type { ProcessReminderCallbackPayload } from '../../reminder/process-reminder.contract';

const taskService = new TaskService();

/**
 * Handles one EventBridge Scheduler callback at reminder fire time.
 *
 * 1. Delegates eligibility check to TaskService (repo + domain rules).
 * 2. Checks patient quiet hours (app-service concern).
 * 3. Dispatches notification via NotificationGateway.
 *
 * Throws for retryable errors (task not found in DB).
 * Returns silently for soft-skip cases (reminders disabled, terminal state, quiet hours).
 */
export async function processReminderCallback(
  payload: ProcessReminderCallbackPayload,
): Promise<void> {
  const result = await taskService.checkReminderFireEligibility({
    runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
  });

  if (result.status === 'skipped') {
    return;
  }

  const { meta } = result;

  if (meta.reminderSettings?.quietHoursRespected) {
    const quietWindow = await getQuietHoursProvider().getForPatient({
      patientId: payload.patientId,
      orgId: payload.orgId,
    });
    if (quietWindow && isInQuietHours(Date.now(), quietWindow)) {
      return;
    }
  }

  await getNotificationGateway().sendReminder({
    runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
    patientId: payload.patientId,
    orgId: payload.orgId,
    channel: payload.channel,
    scheduledAt: payload.scheduledAt,
  });
}

/**
 * Lambda entry point — invoked directly by EventBridge Scheduler (Lambda target, no API Gateway).
 * The Scheduler `Input` must match `ProcessReminderCallbackPayload`.
 */
export async function main(event: ProcessReminderCallbackPayload): Promise<void> {
  await processReminderCallback(event);
}

export default main;
