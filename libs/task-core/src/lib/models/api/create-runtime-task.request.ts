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

export interface CreateRuntimeTaskRequest {
  organizationId: string;
  createdBy: string;
  patientId: string;
  patientDisplayName: string;
  runtimeTaskSource: CreateRuntimeTaskSource;
  taskBehaviorCode: TaskBehaviorCode;
  taskDisplayGroup: TaskDisplayGroup;
  displayTitle: string;
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
