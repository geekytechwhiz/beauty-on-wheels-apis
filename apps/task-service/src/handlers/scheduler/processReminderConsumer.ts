import { REMINDER_STATUS, TaskService, isInQuietHours, nowEpochMs } from '@api-hub/task-core';

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
 * 4. Persists REM#CURRENT status + LOOKUP reminderHistory outcome.
 */
export async function processReminderCallback(
  payload: ProcessReminderCallbackPayload,
): Promise<void> {
  const outcomeBase = {
    runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
    schedulerJobId: payload.schedulerJobId,
    channel: payload.channel,
    scheduledAt: payload.scheduledAt,
  };

  const result = await taskService.checkReminderFireEligibility({
    runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
  });

  if (result.status === 'skipped') {
    await taskService.recordReminderOutcome({
      ...outcomeBase,
      outcome: REMINDER_STATUS.SUPPRESSED,
      reason: result.reason,
    });
    return;
  }

  const { meta } = result;

  if (meta.reminderSettings?.quietHoursRespected) {
    const quietWindow = await getQuietHoursProvider().getForPatient({
      patientId: payload.patientId,
      orgId: payload.orgId,
    });
    if (quietWindow && isInQuietHours(nowEpochMs(), quietWindow)) {
      await taskService.recordReminderOutcome({
        ...outcomeBase,
        outcome: REMINDER_STATUS.SUPPRESSED,
        reason: 'quietHours',
      });
      return;
    }
  }

  try {
    await getNotificationGateway().sendReminder({
      runtimeTaskInstanceId: payload.runtimeTaskInstanceId,
      patientId: payload.patientId,
      orgId: payload.orgId,
      channel: payload.channel,
      scheduledAt: payload.scheduledAt,
    });
    await taskService.recordReminderOutcome({
      ...outcomeBase,
      outcome: REMINDER_STATUS.SENT,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'notificationFailed';
    await taskService.recordReminderOutcome({
      ...outcomeBase,
      outcome: REMINDER_STATUS.FAILED,
      reason,
    });
    throw error;
  }
}

/**
 * Lambda entry point — invoked directly by EventBridge Scheduler (Lambda target, no API Gateway).
 * The Scheduler `Input` must match `ProcessReminderCallbackPayload`.
 */
export async function main(event: ProcessReminderCallbackPayload): Promise<void> {
  await processReminderCallback(event);
}

export default main;
