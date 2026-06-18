import { CARE_PLAN_SYSTEM_ACTOR } from '../../constants/task.constants';
import type { IdempotencyOutcome } from '../types/task-domain.types';
import type {
  AssignedToType,
  ReminderSettings,
  TaskBehaviorCode,
  TaskDisplayGroup,
  WorkflowStage,
} from '../types/task-domain.types';

/** One eligible linkage occurrence after Care Plan Runtime applied the template snapshot. */
export interface CarePlanLinkageMaterialization {
  carePlanTaskLinkageId: string;
  sourceTaskTemplateVersionId?: string;
  taskBehaviorCode: TaskBehaviorCode;
  taskDisplayGroup: TaskDisplayGroup;
  displayTitle: string;
  /** Who completes the task: `patient` or `staff` only. */
  assignedToType: AssignedToType;
  displayToPatient: boolean;
  description?: string;
  assignedToStaffId?: string;
  assignedToStaffDisplayName?: string;
  actionTargetId?: string;
  completionSourceType?: string;
  completionSourceReferenceId?: string;
  dueWindowStart: number;
  dueWindowEnd: number;
  reminderEnabled?: boolean;
  reminderSettings?: ReminderSettings;
  requiredForStageCompletion?: boolean;
  displayAsChecklistItem?: boolean;
}

/** Service payload — `organizationId` from JWT; patient and linkage fields from HTTP body. */
export interface GenerateCarePlanTasksRequest {
  /** Resolved from JWT at the HTTP layer — never from the client body. */
  organizationId: string;
  createdBy: string;
  /** From request body input. */
  patientId: string;
  /** From request body input. */
  patientDisplayName: string;
  carePlanInstanceId: string;
  taskGenerationTrigger: string;
  workflowStage?: WorkflowStage;
  dryRun?: boolean;
  linkages: CarePlanLinkageMaterialization[];
}

export type CreateCarePlanTaskRequest = CarePlanLinkageMaterialization & {
  organizationId: string;
  createdBy: string;
  patientId: string;
  patientDisplayName: string;
  carePlanInstanceId: string;
  taskGenerationTrigger: string;
  workflowStage?: WorkflowStage;
};

export type GenerateCarePlanTasksPayload = GenerateCarePlanTasksRequest;

/** Request body only — `organizationId` is resolved from JWT, not sent by the client. */
export type GenerateCarePlanTasksHttpBody = {
  patientId: string;
  patientDisplayName: string;
  carePlanInstanceId: string;
  taskGenerationTrigger: string;
  workflowStage?: GenerateCarePlanTasksRequest['workflowStage'];
  dryRun?: boolean;
  actorType?: string;
  actorId?: string;
  sourceLinkageContext: {
    linkages: CarePlanLinkageMaterialization[];
  };
};

export type GeneratedCarePlanTaskResultItem = {
  runtimeTaskInstanceId: string;
  outcome: IdempotencyOutcome;
  task: ReturnType<typeof import('../../mappers/task-http.dto').toRuntimeTaskCard>;
};

export type GenerateCarePlanTasksResult = {
  results: GeneratedCarePlanTaskResultItem[];
};

/**
 * Maps validated HTTP body into the service payload.
 * `organizationId` from JWT; `patientId`, `patientDisplayName`, and linkage fields from input.
 */
export function generateCarePlanTasksPayloadFromHttpBody(
  organizationId: string,
  body: GenerateCarePlanTasksHttpBody,
  createdBy: string = CARE_PLAN_SYSTEM_ACTOR,
): GenerateCarePlanTasksPayload {
  return {
    organizationId,
    createdBy,
    patientId: body.patientId,
    patientDisplayName: body.patientDisplayName,
    carePlanInstanceId: body.carePlanInstanceId,
    taskGenerationTrigger: body.taskGenerationTrigger,
    workflowStage: body.workflowStage,
    dryRun: body.dryRun,
    linkages: body.sourceLinkageContext.linkages,
  };
}
