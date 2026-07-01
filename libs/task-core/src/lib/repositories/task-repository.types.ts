import { REMINDER_STATUS } from '../models/types/task-domain.types';
import type { WorkflowStage } from '../models/types/task-domain.types';
import type { RuntimeTaskState } from '../models/types/runtime-task-state.type';
import type { TaskLookupDdbRecord, TaskMetaDdbRecord } from '../models/persistence/task-ddb.model';

export type QueryPatientTasksPageInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  currentState?: RuntimeTaskState;
  excludeTerminalStates?: boolean;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

export type QueryActionCenterTasksPageInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

export type QueryStaffTasksPageInput = {
  organizationId: string;
  staffUserId: string;
  patientId?: string;
  carePlanInstanceId?: string;
  currentState?: RuntimeTaskState;
  excludeTerminalStates?: boolean;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

export type QueryCarePlanTasksForSummaryInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId: string;
  workflowStage?: WorkflowStage;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

export type QueryPatientMetaByCompletionSourceInput = {
  organizationId: string;
  patientId: string;
  completionSourceType: string;
  completionSourceReferenceId: string;
  pageSize: number;
  exclusiveStartKey?: Record<string, unknown>;
};

export type CompleteLinkedSourceObjectRepoInput = {
  meta: TaskMetaDdbRecord;
  lookup: TaskLookupDdbRecord;
  completionEventId: string;
  completedAt: number;
  actorId?: string;
  nowMs?: number;
};

export type RecordReminderRegisteredRepoInput = {
  runtimeTaskInstanceId: string;
  scheduledAt: number;
  channel: string;
  schedulerJobId: string;
  correlationId?: string;
};

export type RecordReminderCancelledRepoInput = {
  runtimeTaskInstanceId: string;
  reason: string;
  correlationId?: string;
};

export type RecordReminderOutcomeRepoInput = {
  runtimeTaskInstanceId: string;
  outcome: typeof REMINDER_STATUS.SENT | typeof REMINDER_STATUS.SUPPRESSED | typeof REMINDER_STATUS.FAILED;
  reason?: string;
  schedulerJobId?: string;
  channel?: string;
  scheduledAt?: number;
};
