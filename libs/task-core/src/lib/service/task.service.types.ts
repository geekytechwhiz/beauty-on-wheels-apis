import type {
  GetTaskStatusSummaryInput,
  TaskStatusSummaryResult,
} from '../models/api/get-task-status-summary.types';
import type {
  CompletionEvidenceDdbRecord,
  TaskEvidenceSummaryDdbRecord,
  TaskMetaDdbRecord,
} from '../models/persistence/task-ddb.model';
import type { RuntimeTaskState } from '../models/types/runtime-task-state.type';
import type {
  IdempotencyOutcome,
  SurfaceSection,
  WorkflowStage,
} from '../models/types/task-domain.types';
import type { toActionCenterTaskCard, toRuntimeTaskCard, toTaskHistoryEntry } from '../mappers/task-http.dto';
import type { ActionCenterSurfaceFilter } from '../utils/surface-section';

export type TaskRecord = TaskMetaDdbRecord;

export type CreateMonitoringActionResult = {
  record: TaskMetaDdbRecord;
  outcome: IdempotencyOutcome;
};

export type CreateRuntimeTaskResult = {
  record: TaskMetaDdbRecord;
};

export type GetRuntimeTaskDetailInput = {
  organizationId: string;
  runtimeTaskInstanceId: string;
  includeRelated?: boolean;
};

export type RuntimeTaskDetail = {
  task: ReturnType<typeof toRuntimeTaskCard>;
  reminders?: unknown[];
  completionEvidence?: CompletionEvidenceDdbRecord[];
  evidenceSummary?: TaskEvidenceSummaryDdbRecord;
};

export type GetRuntimeTaskHistoryInput = {
  organizationId: string;
  runtimeTaskInstanceId: string;
  pageSize: number;
  nextToken?: string;
};

export type PaginatedTaskHistory = {
  items: ReturnType<typeof toTaskHistoryEntry>[];
  nextToken?: string;
};

export type RuntimeTaskCard = ReturnType<typeof toRuntimeTaskCard>;

export type ListPatientTasksInput = {
  organizationId: string;
  patientId: string;
  /** When set, staffTasks includes only non-patient tasks assigned to this id. */
  staffUserId?: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  currentState?: RuntimeTaskState;
  pageSize: number;
  nextToken?: string;
};

export type PatientTaskListResult = {
  patientId: string;
  staffUserId?: string;
  patientTasks: { items: RuntimeTaskCard[] };
  staffTasks: { items: RuntimeTaskCard[] };
  nextToken?: string;
};

export type ListStaffTasksInput = {
  organizationId: string;
  staffUserId: string;
  patientId?: string;
  carePlanInstanceId?: string;
  currentState?: RuntimeTaskState;
  pageSize: number;
  nextToken?: string;
};

export type PaginatedRuntimeTaskCards = {
  items: RuntimeTaskCard[];
  nextToken?: string;
};

export type ActionCenterTaskCard = ReturnType<typeof toActionCenterTaskCard>;

export type ListActionCenterItemsInput = {
  organizationId: string;
  patientId: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  surfaceSection: ActionCenterSurfaceFilter;
  timezone?: string;
  pageSize: number;
  nextToken?: string;
};

export type ActionCenterGroupedResult = {
  patientId: string;
  carePlanInstanceId?: string;
  timezone: string;
  sections: Record<SurfaceSection, ActionCenterTaskCard[]>;
  nextToken?: string;
};

export type ActionCenterSingleSectionResult = {
  patientId: string;
  carePlanInstanceId?: string;
  timezone: string;
  surfaceSection: SurfaceSection;
  items: ActionCenterTaskCard[];
  nextToken?: string;
};

export type ActionCenterItemsResult = ActionCenterGroupedResult | ActionCenterSingleSectionResult;

export type { GetTaskStatusSummaryInput, TaskStatusSummaryResult };
