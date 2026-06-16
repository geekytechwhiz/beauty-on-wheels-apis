import { randomUUID } from 'crypto';

import type { TaskEvidenceSummaryDdbRecord } from '../models/persistence/task-ddb.model';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { REMINDER_STATUS } from '../models/types/task-domain.types';
import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';

export type ReminderHistoryEntry = {
  reminderRecordId: string;
  scheduledReminderAt?: number;
  reminderChannel?: string;
  reminderStatus: string;
  updatedAt?: number;
  sentAt?: number;
  schedulerJobId?: string;
  failureReason?: string;
  suppressedReason?: string;
};

const CANCELLABLE_REMINDER_STATUSES = new Set<string>([
  REMINDER_STATUS.SCHEDULED,
  'Scheduled',
]);

export function cancelReminderHistoryEntries(
  reminderHistory: unknown[] | undefined,
  nowMs: number,
): { entries: ReminderHistoryEntry[]; hadCancellable: boolean } {
  if (!reminderHistory?.length) {
    return { entries: [], hadCancellable: false };
  }

  let hadCancellable = false;
  const entries = reminderHistory.map((raw) => {
    const entry = { ...(raw as ReminderHistoryEntry) };
    if (CANCELLABLE_REMINDER_STATUSES.has(entry.reminderStatus)) {
      hadCancellable = true;
      entry.reminderStatus = REMINDER_STATUS.CANCELLED;
      entry.updatedAt = nowMs;
    }
    return entry;
  });

  return { entries, hadCancellable };
}

export function buildEvidenceSummaryRollup(
  meta: TaskMetaDdbRecord,
  toState: RuntimeTaskState,
  nowMs: number,
  latestCompletionSummary?: string,
): TaskEvidenceSummaryDdbRecord {
  const summary: TaskEvidenceSummaryDdbRecord = {
    taskEvidenceSummaryId: `sum-${meta.runtimeTaskInstanceId}-latest`,
    runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    generatedAt: nowMs,
    currentState: toState,
    runtimeTaskSource: meta.runtimeTaskSource,
    taskBehaviorCode: meta.taskBehaviorCode,
    taskDisplayGroup: meta.taskDisplayGroup,
    ...(meta.carePlanInstanceId ? { carePlanInstanceId: meta.carePlanInstanceId } : {}),
    ...(meta.workflowStage ? { workflowStage: meta.workflowStage } : {}),
    ...(meta.requiredForStageCompletion != null
      ? { requiredForStageCompletion: meta.requiredForStageCompletion }
      : {}),
    ...(meta.completionSourceType ? { completionSourceType: meta.completionSourceType } : {}),
    ...(meta.completionSourceReferenceId
      ? { completionSourceReferenceId: meta.completionSourceReferenceId }
      : {}),
  };

  if (toState === RUNTIME_TASK_STATE.COMPLETED) {
    summary.completedAt = nowMs;
    summary.latestCompletionSummary =
      latestCompletionSummary ?? meta.displayTitle ?? 'Task completed';
  }
  if (toState === RUNTIME_TASK_STATE.MISSED) {
    summary.missedAt = nowMs;
    summary.latestCompletionSummary = latestCompletionSummary ?? 'Task missed';
  }

  return summary;
}

export function newCompletionEvidenceId(): string {
  return `evid-${randomUUID()}`;
}
