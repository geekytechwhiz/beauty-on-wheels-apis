import type {
  IncompleteRequiredTaskItem,
  TaskStatusSummaryCounts,
  TaskStatusSummaryResult,
} from '../models/api/get-task-status-summary.types';
import type { TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';
import {
  RUNTIME_TASK_STATE,
  resolveCurrentStateForWire,
  type RuntimeTaskState,
} from '../models/types/runtime-task-state.type';
import { READINESS_STATUS, type ReadinessStatus, type WorkflowStage } from '../models/types/task-domain.types';
import { DEFAULT_ACTION_CENTER_TIMEZONE, nowEpochMs } from './task-time';
import { omitUndefined } from './omit-undefined';

export type AggregateTaskStatusSummaryContext = {
  orgId: string;
  patientId: string;
  carePlanInstanceId: string;
  workflowStage?: WorkflowStage;
  timeZone?: string;
};

function emptyCounts(): TaskStatusSummaryCounts {
  return {
    total: 0,
    requiredTotal: 0,
    completed: 0,
    missed: 0,
    active: 0,
    scheduled: 0,
  };
}

function incrementStateBucket(counts: TaskStatusSummaryCounts, wireState: RuntimeTaskState): void {
  switch (wireState) {
    case RUNTIME_TASK_STATE.COMPLETED:
      counts.completed++;
      break;
    case RUNTIME_TASK_STATE.MISSED:
      counts.missed++;
      break;
    case RUNTIME_TASK_STATE.SCHEDULED:
      counts.scheduled++;
      break;
    case RUNTIME_TASK_STATE.ACTIVE:
      counts.active++;
      break;
    default:
      break;
  }
}

function isRequiredTask(record: TaskMetaDdbRecord): boolean {
  return record.requiredForStageCompletion === true;
}

function isRequiredIncomplete(record: TaskMetaDdbRecord): boolean {
  return isRequiredTask(record) && record.currentState !== RUNTIME_TASK_STATE.COMPLETED;
}

export function aggregateTaskStatusSummary(
  records: TaskMetaDdbRecord[],
  context: AggregateTaskStatusSummaryContext,
): TaskStatusSummaryResult {
  const counts = emptyCounts();
  const incompleteRequiredTasks: IncompleteRequiredTaskItem[] = [];
  const timeZone = context.timeZone ?? DEFAULT_ACTION_CENTER_TIMEZONE;
  const nowMs = nowEpochMs();

  for (const record of records) {
    counts.total++;
    if (isRequiredTask(record)) {
      counts.requiredTotal++;
    }
    const wireState = resolveCurrentStateForWire({
      persistedState: record.currentState,
      dueWindowStart: record.dueWindowStart,
      dueWindowEnd: record.dueWindowEnd,
      timeZone,
      nowMs,
    });
    incrementStateBucket(counts, wireState);

    if (isRequiredIncomplete(record)) {
      incompleteRequiredTasks.push({
        runtimeTaskInstanceId: record.runtimeTaskInstanceId,
        displayTitle: record.displayTitle,
        requiredForStageCompletion: record.requiredForStageCompletion,
        currentState: wireState,
      });
    }
  }

  let readinessStatus: ReadinessStatus = READINESS_STATUS.NOT_APPLICABLE;
  if (counts.requiredTotal > 0) {
    readinessStatus =
      incompleteRequiredTasks.length === 0 ? READINESS_STATUS.READY : READINESS_STATUS.NOT_READY;
  }

  return omitUndefined({
    orgId: context.orgId,
    patientId: context.patientId,
    carePlanInstanceId: context.carePlanInstanceId,
    workflowStage: context.workflowStage,
    readinessStatus,
    counts,
    incompleteRequiredTasks: incompleteRequiredTasks.length > 0 ? incompleteRequiredTasks : undefined,
  }) as TaskStatusSummaryResult;
}
