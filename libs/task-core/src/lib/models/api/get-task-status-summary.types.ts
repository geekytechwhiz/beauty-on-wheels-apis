import type { ReadinessStatus, WorkflowStage } from '../types/task-domain.types';
import type { RuntimeTaskState } from '../types/runtime-task-state.type';

export type GetTaskStatusSummaryInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId: string;
  workflowStage?: WorkflowStage;
};

export type TaskStatusSummaryCounts = {
  total: number;
  requiredTotal: number;
  completed: number;
  missed: number;
  active: number;
  scheduled: number;
};

export type IncompleteRequiredTaskItem = {
  runtimeTaskInstanceId: string;
  displayTitle: string;
  requiredForStageCompletion?: boolean;
  currentState: RuntimeTaskState;
};

export type TaskStatusSummaryResult = {
  orgId: string;
  patientId: string;
  carePlanInstanceId: string;
  workflowStage?: WorkflowStage;
  readinessStatus: ReadinessStatus;
  counts: TaskStatusSummaryCounts;
  incompleteRequiredTasks?: IncompleteRequiredTaskItem[];
};
