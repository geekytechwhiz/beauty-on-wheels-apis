import type {
  AssignedToType,
  OwnerType,
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
  ownerType?: OwnerType;
  ownerUserId?: string;
  ownerRoleCode?: string;
  ownerTeamId?: string;
  ownerDisplayName?: string;
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
  taskSk: string;
  dueWindowStart?: number;
  dueWindowEnd?: number;
  carePlanInstanceId?: string;
  assignedToStaffId?: string;
  ownerType?: OwnerType;
  ownerUserId?: string;
  ownerRoleCode?: string;
  ownerTeamId?: string;
  ownerDisplayName?: string;
  reminderHistory?: unknown[];
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
}

export type TaskDdbRecord = TaskMetaDdbRecord | TaskLookupDdbRecord | TaskHistDdbRecord;
