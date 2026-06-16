import type {
  AssignedToType,
  ReminderSettings,
  RuntimeTaskSource,
  TaskBehaviorCode,
  TaskDisplayGroup,
  TaskHistoryEventType,
  TransitionSource,
  WorkflowStage,
} from '../types/task-domain.types';
import type { RuntimeTaskState } from '../types/runtime-task-state.type';

export interface TaskMetaDdbRecord {
  pk: string;
  sk: string;
  entityType: 'RuntimeTaskInstance';
  orgId: string;
  patientId: string;
  patientDisplayName?: string;
  runtimeTaskInstanceId: string;
  runtimeTaskSource: RuntimeTaskSource;
  carePlanInstanceId?: string;
  carePlanTaskLinkageId?: string;
  sourceTaskTemplateVersionId?: string;
  taskGenerationTrigger?: string;
  monitoringInstanceId?: string;
  taskBehaviorCode: TaskBehaviorCode;
  taskDisplayGroup: TaskDisplayGroup;
  displayTitle: string;
  description?: string;
  assignedToType: AssignedToType;
  assignedToStaffId?: string;
  assignedToStaffDisplayName?: string;
  workflowStage?: WorkflowStage;
  actionTargetId?: string;
  completionSourceType?: string;
  completionSourceReferenceId?: string;
  requiredForStageCompletion?: boolean;
  displayAsChecklistItem?: boolean;
  displayToPatient: boolean;
  currentState: RuntimeTaskState;
  dueWindowStart?: number;
  dueWindowEnd?: number;
  reminderEnabled?: boolean;
  reminderSettings?: ReminderSettings;
  idempotencyKey?: string;
  generationHash?: string;
  lsi1Sk?: string;
  gsi1Pk?: string;
  gsi1Sk?: string;
  createdAt: number;
  createdBy: string;
  lastUpdatedAt: number;
  lastUpdatedBy: string;
  version?: number;
}

export interface TaskLookupDdbRecord {
  pk: string;
  sk: 'LOOKUP';
  entityType: 'TaskLookup';
  runtimeTaskInstanceId: string;
  orgId: string;
  patientId: string;
  patientDisplayName?: string;
  taskSk: string;
  dueWindowStart?: number;
  dueWindowEnd?: number;
  carePlanInstanceId?: string;
  assignedToStaffId?: string;
  assignedToStaffDisplayName?: string;
  reminderHistory?: unknown[];
  evidenceSummary?: TaskEvidenceSummaryDdbRecord;
}

export interface TaskEvidenceSummaryDdbRecord {
  taskEvidenceSummaryId?: string;
  runtimeTaskInstanceId?: string;
  generatedAt: number;
  latestCompletionSummary?: string;
  currentState?: RuntimeTaskState;
  completedAt?: number;
  missedAt?: number;
  completionSourceType?: string;
  completionSourceReferenceId?: string;
  [key: string]: unknown;
}

export interface CompletionEvidenceDdbRecord {
  pk: string;
  sk: string;
  entityType?: 'CompletionEvidence';
  completionEvidenceId: string;
  runtimeTaskInstanceId: string;
  orgId: string;
  patientId: string;
  completionSource: string;
  completionSourceType?: string;
  completionSourceReferenceId?: string;
  completionEventId?: string;
  completedAt: number;
  completedBy?: string;
  evidencePayload?: Record<string, unknown>;
}

export interface TaskHistDdbRecord {
  pk: string;
  sk: string;
  entityType: 'TaskStateHistory';
  taskStateHistoryId: string;
  runtimeTaskInstanceId: string;
  orgId: string;
  patientId: string;
  historyEventType: TaskHistoryEventType;
  fromState?: RuntimeTaskState;
  toState?: RuntimeTaskState;
  transitionAt: number;
  transitionBy: string;
  transitionSource: TransitionSource;
  transitionReason?: string;
  previousAssignedToStaffId?: string;
  newAssignedToStaffId?: string;
  previousAssignedToStaffDisplayName?: string;
  newAssignedToStaffDisplayName?: string;
}

export type TaskDdbRecord =
  | TaskMetaDdbRecord
  | TaskLookupDdbRecord
  | TaskHistDdbRecord
  | CompletionEvidenceDdbRecord;
