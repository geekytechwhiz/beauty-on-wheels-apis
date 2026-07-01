import type { TaskEvidenceSummaryDdbRecord } from '../models/persistence/task-ddb.model';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import { TaskIdBuilder } from '../builder/task-id.builder';import { RUNTIME_TASK_STATE, type RuntimeTaskState } from '../models/types/runtime-task-state.type';
import { omitUndefined } from './omit-undefined';

export function buildEvidenceSummaryRollup(
  meta: TaskMetaDdbRecord,
  toState: RuntimeTaskState,
  nowMs: number,
  latestCompletionSummary?: string,
): TaskEvidenceSummaryDdbRecord {
  const completed = toState === RUNTIME_TASK_STATE.COMPLETED;
  const missed = toState === RUNTIME_TASK_STATE.MISSED;

  return omitUndefined({
    taskEvidenceSummaryId: TaskIdBuilder.buildEvidenceSummaryId(meta.runtimeTaskInstanceId),
    runtimeTaskInstanceId: meta.runtimeTaskInstanceId,
    generatedAt: nowMs,
    currentState: toState,
    runtimeTaskSource: meta.runtimeTaskSource,
    taskBehaviorCode: meta.taskBehaviorCode,
    taskDisplayGroup: meta.taskDisplayGroup,
    carePlanInstanceId: meta.carePlanInstanceId,
    workflowStage: meta.workflowStage,
    requiredForStageCompletion: meta.requiredForStageCompletion ?? undefined,
    completionSourceType: meta.completionSourceType,
    completionSourceReferenceId: meta.completionSourceReferenceId,
    completedAt: completed ? nowMs : undefined,
    missedAt: missed ? nowMs : undefined,
    latestCompletionSummary: completed
      ? (latestCompletionSummary ?? meta.displayTitle ?? 'Task completed')
      : missed
        ? (latestCompletionSummary ?? 'Task missed')
        : undefined,
  }) as TaskEvidenceSummaryDdbRecord;
}
