import { CARE_PLAN_SYSTEM_ACTOR } from '../../constants/task.constants';
import type { IdempotencyOutcome } from '../types/task-domain.types';
import type {
  AssignedToType,
  OwnerType,
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
  assignedToType: AssignedToType;
  displayToPatient: boolean;
  description?: string;
  assignedToStaffId?: string;
  ownerType?: OwnerType;
  ownerUserId?: string;
  ownerRoleCode?: string;
  ownerTeamId?: string;
  ownerDisplayName?: string;
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

export interface GenerateCarePlanTasksRequest {
  organizationId: string;
  createdBy: string;
  patientId: string;
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
  carePlanInstanceId: string;
  taskGenerationTrigger: string;
  workflowStage?: WorkflowStage;
};

export type GenerateCarePlanTasksPayload = GenerateCarePlanTasksRequest;

export type GenerateCarePlanTasksHttpBody = {
  patientId: string;
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

export function generateCarePlanTasksPayloadFromHttpBody(
  organizationId: string,
  body: GenerateCarePlanTasksHttpBody,
  createdBy: string = CARE_PLAN_SYSTEM_ACTOR,
): GenerateCarePlanTasksPayload {
  return {
    organizationId,
    createdBy,
    patientId: body.patientId,
    carePlanInstanceId: body.carePlanInstanceId,
    taskGenerationTrigger: body.taskGenerationTrigger,
    workflowStage: body.workflowStage,
    dryRun: body.dryRun,
    linkages: body.sourceLinkageContext.linkages,
  };
}
