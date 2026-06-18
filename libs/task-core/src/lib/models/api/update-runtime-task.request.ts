import type { WorkflowStage } from '../types/task-domain.types';
import type { TaskHistDdbRecord, TaskMetaDdbRecord } from '../persistence/task-ddb.model';
import type { toRuntimeTaskCard, toTaskHistoryEntry } from '../../mappers/task-http.dto';

export const RUNTIME_TASK_METADATA_FIELDS = [
  'displayTitle',
  'description',
  'displayToPatient',
  'requiredForStageCompletion',
  'displayAsChecklistItem',
  'workflowStage',
  'actionTargetId',
  'completionSourceType',
  'completionSourceReferenceId',
  'patientDisplayName',
] as const;

export type RuntimeTaskMetadataField = (typeof RUNTIME_TASK_METADATA_FIELDS)[number];

export type RuntimeTaskMetadataPatch = {
  displayTitle?: string;
  description?: string | null;
  displayToPatient?: boolean;
  requiredForStageCompletion?: boolean;
  displayAsChecklistItem?: boolean;
  workflowStage?: WorkflowStage;
  actionTargetId?: string | null;
  completionSourceType?: string | null;
  completionSourceReferenceId?: string | null;
  patientDisplayName?: string;
};

export interface UpdateRuntimeTaskRequest {
  organizationId: string;
  runtimeTaskInstanceId: string;
  actorId: string;
  reason?: string;
  patch: RuntimeTaskMetadataPatch;
}

export interface UpdateRuntimeTaskResult {
  runtimeTaskInstanceId: string;
  task: ReturnType<typeof toRuntimeTaskCard>;
  historyEntry: ReturnType<typeof toTaskHistoryEntry>;
}

export type RuntimeTaskMetadataDiff = {
  changedFields: RuntimeTaskMetadataField[];
  previousValues: Partial<Record<RuntimeTaskMetadataField, unknown>>;
  newValues: Partial<Record<RuntimeTaskMetadataField, unknown>>;
  metaUpdates: Partial<TaskMetaDdbRecord>;
  lookupUpdates: Partial<{ patientDisplayName: string }>;
};

export type UpdateRuntimeTaskRepoInput = {
  meta: TaskMetaDdbRecord;
  lookup: import('../persistence/task-ddb.model').TaskLookupDdbRecord;
  actorId: string;
  reason?: string;
  diff: RuntimeTaskMetadataDiff;
};

export type UpdateRuntimeTaskRepoResult = {
  record: TaskMetaDdbRecord;
  historyEntry: TaskHistDdbRecord;
};
