import {
  RUNTIME_TASK_SOURCE,
  type AssignedToType,
  type TaskBehaviorCode,
  type TaskDisplayGroup,
  type WorkflowStage,
} from '../types/task-domain.types';

export type CreateRuntimeTaskSource =
  | typeof RUNTIME_TASK_SOURCE.SERVICE_FLOW_RUNTIME
  | typeof RUNTIME_TASK_SOURCE.MANUAL_SYSTEM;

/** Service payload — `organizationId` from JWT; patient and task fields from HTTP body. */
export interface CreateRuntimeTaskRequest {
  /** Resolved from JWT at the HTTP layer — never from the client body. */
  organizationId: string;
  createdBy: string;
  /** From request body input. */
  patientId: string;
  /** From request body input. */
  patientDisplayName: string;
  runtimeTaskSource: CreateRuntimeTaskSource;
  taskBehaviorCode: TaskBehaviorCode;
  taskDisplayGroup: TaskDisplayGroup;
  displayTitle: string;
  /** Who completes the task: `patient` or `staff` only. */
  assignedToType: AssignedToType;
  displayToPatient: boolean;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  description?: string;
  assignedToStaffId?: string;
  assignedToStaffDisplayName?: string;
  actionTargetId?: string;
  completionSourceType?: string;
  completionSourceReferenceId?: string;
  dueWindowStart?: number;
  dueWindowEnd?: number;
  reminderEnabled?: boolean;
  requiredForStageCompletion?: boolean;
  displayAsChecklistItem?: boolean;
}

