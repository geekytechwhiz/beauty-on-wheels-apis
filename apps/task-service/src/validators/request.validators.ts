import type { LambdaRequest } from '@api-hub/utils';

import {
  assertValidTimeZone,
  CARE_PLAN_SYSTEM_ACTOR,
  DEFAULT_ACTION_CENTER_TIMEZONE,
  manualSystemActor,
  RUNTIME_TASK_METADATA_FIELDS,
  RUNTIME_TASK_STATE,
  SERVICE_FLOW_SYSTEM_ACTOR,
  SURFACE_SECTION,
  TASK_LIST_DEFAULT_PAGE_SIZE,
  TASK_LIST_MAX_PAGE_SIZE,
  WORKFLOW_STAGE,
  type ActionCenterSurfaceFilter,
  type RuntimeTaskState,
  type SurfaceSection,
  type TaskRuntimeAction,
  type WorkflowStage,
} from '@api-hub/task-core';

import { getActorUserIdForRequest, getOrganizationIdForRequest } from '../utils/helpers';
import type {
  CreateMonitoringActionHttpBody,
  CreateRuntimeTaskHttpBody,
  GenerateCarePlanTasksHttpBody,
  UpdateAssignedStaffHttpBody,
  UpdateReminderSettingsHttpBody,
  UpdateRuntimeTaskHttpBody,
  UpdateTaskStateHttpBody,
} from './task.schemas';

function throwVal(
  message: string,
  statusCode = 400,
  code = 'VALIDATION_ERROR',
): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  throw err;
}

export type ValidatedCreateMonitoringAction = {
  orgId: string;
  authHeader: string | undefined;
  body: CreateMonitoringActionHttpBody;
};

export function validateCreateMonitoringActionRequest(req: LambdaRequest): void {
  const body = req.body as CreateMonitoringActionHttpBody;

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  (req as LambdaRequest & { validatedCreateMonitoringAction: ValidatedCreateMonitoringAction }).validatedCreateMonitoringAction =
    {
      orgId,
      body,
      authHeader: req.context.authHeader,
    };
}

export type ValidatedCreateRuntimeTask = {
  orgId: string;
  createdBy: string;
  authHeader: string | undefined;
  body: CreateRuntimeTaskHttpBody;
};

export function validateCreateRuntimeTaskRequest(req: LambdaRequest): void {
  const body = req.body as CreateRuntimeTaskHttpBody;

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  let createdBy: string;
  if (body.runtimeTaskSource === 'manualSystem') {
    const actorUserId = getActorUserIdForRequest(req.event, req.context.authHeader);
    if (!actorUserId) {
      throwVal(
        'Authenticated user could not be resolved from the access token for manualSystem create',
        422,
        'VALIDATION_ERROR',
      );
    }
    createdBy = manualSystemActor(actorUserId!);
  } else {
    createdBy = SERVICE_FLOW_SYSTEM_ACTOR;
  }

  (req as LambdaRequest & { validatedCreateRuntimeTask: ValidatedCreateRuntimeTask }).validatedCreateRuntimeTask =
    {
      orgId,
      createdBy,
      body,
      authHeader: req.context.authHeader,
    };
}

/** `orgId` from JWT; `body.patientId` / `body.patientDisplayName` from request input. */
export type ValidatedGenerateCarePlanTasks = {
  orgId: string;
  createdBy: string;
  authHeader: string | undefined;
  body: GenerateCarePlanTasksHttpBody;
};

export function validateGenerateCarePlanTasksRequest(req: LambdaRequest): void {
  const body = req.body as GenerateCarePlanTasksHttpBody;

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const createdBy = body.actorId
    ? `${CARE_PLAN_SYSTEM_ACTOR}:${body.actorId}`
    : CARE_PLAN_SYSTEM_ACTOR;

  (req as LambdaRequest & { validatedGenerateCarePlanTasks: ValidatedGenerateCarePlanTasks }).validatedGenerateCarePlanTasks =
    {
      orgId,
      createdBy,
      body,
      authHeader: req.context.authHeader,
    };
}

export type ValidatedGetRuntimeTask = {
  orgId: string;
  runtimeTaskInstanceId: string;
  includeRelated: boolean;
  authHeader: string | undefined;
};

export function validateGetRuntimeTaskRequest(req: LambdaRequest): void {
  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const runtimeTaskInstanceId = req.pathParameters?.runtimeTaskInstanceId;
  if (!runtimeTaskInstanceId) {
    throwVal('runtimeTaskInstanceId path parameter is required', 400, 'VALIDATION_ERROR');
  }

  const includeRelated = req.params?.includeRelated === 'false' ? false : true;

  (req as LambdaRequest & { validatedGetRuntimeTask: ValidatedGetRuntimeTask }).validatedGetRuntimeTask =
    {
      orgId,
      runtimeTaskInstanceId,
      includeRelated,
      authHeader: req.context.authHeader,
    };
}

export type ValidatedGetRuntimeTaskHistory = {
  orgId: string;
  runtimeTaskInstanceId: string;
  pageSize: number;
  nextToken?: string;
  authHeader: string | undefined;
};

const WORKFLOW_STAGE_VALUES = Object.values(WORKFLOW_STAGE) as WorkflowStage[];
const RUNTIME_TASK_STATE_VALUES = Object.values(RUNTIME_TASK_STATE) as RuntimeTaskState[];
const SURFACE_SECTION_VALUES = Object.values(SURFACE_SECTION) as SurfaceSection[];
const ACTION_CENTER_SURFACE_VALUES: ActionCenterSurfaceFilter[] = [
  ...SURFACE_SECTION_VALUES,
  'all',
];

function parsePageSize(raw: string | undefined): number {
  if (!raw?.trim()) return TASK_LIST_DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throwVal('pageSize must be a positive integer', 400, 'VALIDATION_ERROR');
  }
  if (n > TASK_LIST_MAX_PAGE_SIZE) {
    throwVal(`pageSize must not exceed ${TASK_LIST_MAX_PAGE_SIZE}`, 400, 'VALIDATION_ERROR');
  }
  return n;
}

function parseOptionalEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throwVal(`${fieldName} must be one of: ${allowed.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
  return value as T;
}

export function validateGetRuntimeTaskHistoryRequest(req: LambdaRequest): void {
  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const runtimeTaskInstanceId = req.pathParameters?.runtimeTaskInstanceId;
  if (!runtimeTaskInstanceId) {
    throwVal('runtimeTaskInstanceId path parameter is required', 400, 'VALIDATION_ERROR');
  }

  const pageSize = parsePageSize(req.params?.pageSize);
  const nextToken = req.params?.nextToken?.trim() || undefined;

  (req as LambdaRequest & { validatedGetRuntimeTaskHistory: ValidatedGetRuntimeTaskHistory })
    .validatedGetRuntimeTaskHistory = {
    orgId,
    runtimeTaskInstanceId,
    pageSize,
    nextToken,
    authHeader: req.context.authHeader,
  };
}

export type ValidatedGetTasks = {
  orgId: string;
  patientId: string;
  staffUserId?: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  currentState?: RuntimeTaskState;
  pageSize: number;
  nextToken?: string;
  authHeader: string | undefined;
};

export type ValidatedGetStaffTasks = {
  orgId: string;
  staffUserId: string;
  patientId?: string;
  carePlanInstanceId?: string;
  currentState?: RuntimeTaskState;
  pageSize: number;
  nextToken?: string;
  authHeader: string | undefined;
};

export function validateGetTasksRequest(req: LambdaRequest): void {
  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const patientId = req.params?.patientId?.trim();
  if (!patientId) {
    throwVal('patientId query parameter is required', 400, 'VALIDATION_ERROR');
  }

  const carePlanInstanceId = req.params?.carePlanInstanceId?.trim() || undefined;
  const workflowStage = parseOptionalEnum(
    req.params?.workflowStage,
    WORKFLOW_STAGE_VALUES,
    'workflowStage',
  );
  const currentState = parseOptionalEnum(
    req.params?.currentState,
    RUNTIME_TASK_STATE_VALUES,
    'currentState',
  );
  const staffUserId = req.params?.staffUserId?.trim() || undefined;
  const pageSize = parsePageSize(req.params?.pageSize);
  const nextToken = req.params?.nextToken?.trim() || undefined;

  (req as LambdaRequest & { validatedGetTasks: ValidatedGetTasks }).validatedGetTasks = {
    orgId,
    patientId,
    staffUserId,
    carePlanInstanceId,
    workflowStage,
    currentState,
    pageSize,
    nextToken,
    authHeader: req.context.authHeader,
  };
}

export function validateGetStaffTasksRequest(req: LambdaRequest): void {
  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const staffUserId = req.params?.staffUserId?.trim();
  if (!staffUserId) {
    throwVal('staffUserId query parameter is required', 400, 'VALIDATION_ERROR');
  }

  const actorUserId = getActorUserIdForRequest(req.event, req.context.authHeader);
  if (!actorUserId) {
    throwVal('Authenticated user could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }
  if (actorUserId !== staffUserId) {
    throwVal('staffUserId must match the authenticated user', 403, 'FORBIDDEN');
  }

  const patientId = req.params?.patientId?.trim() || undefined;
  const carePlanInstanceId = req.params?.carePlanInstanceId?.trim() || undefined;
  const currentState = parseOptionalEnum(
    req.params?.currentState,
    RUNTIME_TASK_STATE_VALUES,
    'currentState',
  );
  const pageSize = parsePageSize(req.params?.pageSize);
  const nextToken = req.params?.nextToken?.trim() || undefined;

  (req as LambdaRequest & { validatedGetStaffTasks: ValidatedGetStaffTasks }).validatedGetStaffTasks =
    {
      orgId,
      staffUserId,
      patientId,
      carePlanInstanceId,
      currentState,
      pageSize,
      nextToken,
      authHeader: req.context.authHeader,
    };
}

export type ValidatedGetActionCenterItems = {
  orgId: string;
  patientId: string;
  carePlanInstanceId?: string;
  workflowStage?: WorkflowStage;
  surfaceSection: ActionCenterSurfaceFilter;
  timezone: string;
  pageSize: number;
  nextToken?: string;
  authHeader: string | undefined;
};

export function validateGetActionCenterItemsRequest(req: LambdaRequest): void {
  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const patientId = req.params?.patientId?.trim();
  if (!patientId) {
    throwVal('patientId query parameter is required', 400, 'VALIDATION_ERROR');
  }

  const surfaceSectionRaw = req.params?.surfaceSection?.trim();
  if (!surfaceSectionRaw) {
    throwVal('surfaceSection query parameter is required', 400, 'VALIDATION_ERROR');
  }
  if (!ACTION_CENTER_SURFACE_VALUES.includes(surfaceSectionRaw as ActionCenterSurfaceFilter)) {
    throwVal('surfaceSection must be a valid Action Center section or all', 400, 'VALIDATION_ERROR');
  }

  const timezoneRaw = req.params?.timezone?.trim() || DEFAULT_ACTION_CENTER_TIMEZONE;
  try {
    assertValidTimeZone(timezoneRaw);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Invalid timezone';
    throwVal(message, 400, 'VALIDATION_ERROR');
  }

  const carePlanInstanceId = req.params?.carePlanInstanceId?.trim() || undefined;
  const workflowStage = parseOptionalEnum(
    req.params?.workflowStage,
    WORKFLOW_STAGE_VALUES,
    'workflowStage',
  );
  const pageSize = parsePageSize(req.params?.pageSize);
  const nextToken = req.params?.nextToken?.trim() || undefined;

  (req as LambdaRequest & { validatedGetActionCenterItems: ValidatedGetActionCenterItems })
    .validatedGetActionCenterItems = {
    orgId,
    patientId,
    carePlanInstanceId,
    workflowStage,
    surfaceSection: surfaceSectionRaw as ActionCenterSurfaceFilter,
    timezone: timezoneRaw,
    pageSize,
    nextToken,
    authHeader: req.context.authHeader,
  };
}

export type ValidatedUpdateAssignedStaff = {
  orgId: string;
  runtimeTaskInstanceId: string;
  body: UpdateAssignedStaffHttpBody;
  authHeader: string | undefined;
};

export function validateUpdateAssignedStaffRequest(req: LambdaRequest): void {
  const body = req.body as UpdateAssignedStaffHttpBody;

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const runtimeTaskInstanceId = req.pathParameters?.runtimeTaskInstanceId;
  if (!runtimeTaskInstanceId) {
    throwVal('runtimeTaskInstanceId path parameter is required', 400, 'VALIDATION_ERROR');
  }

  (req as LambdaRequest & { validatedUpdateAssignedStaff: ValidatedUpdateAssignedStaff })
    .validatedUpdateAssignedStaff = {
    orgId,
    runtimeTaskInstanceId,
    body,
    authHeader: req.context.authHeader,
  };
}

export type ValidatedUpdateTaskState = {
  orgId: string;
  runtimeTaskInstanceId: string;
  body: UpdateTaskStateHttpBody;
  authHeader: string | undefined;
};

export function validateUpdateTaskStateRequest(req: LambdaRequest): void {
  const body = req.body as UpdateTaskStateHttpBody;

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const runtimeTaskInstanceId = req.pathParameters?.runtimeTaskInstanceId;
  if (!runtimeTaskInstanceId) {
    throwVal('runtimeTaskInstanceId path parameter is required', 400, 'VALIDATION_ERROR');
  }

  (req as LambdaRequest & { validatedUpdateTaskState: ValidatedUpdateTaskState })
    .validatedUpdateTaskState = {
    orgId,
    runtimeTaskInstanceId,
    body: {
      ...body,
      action: body.action as TaskRuntimeAction,
      expectedCurrentState: body.expectedCurrentState as RuntimeTaskState,
    },
    authHeader: req.context.authHeader,
  };
}

export type ValidatedGetTaskStatusSummary = {
  orgId: string;
  patientId: string;
  carePlanInstanceId: string;
  workflowStage?: WorkflowStage;
  authHeader: string | undefined;
};

export function validateGetTaskStatusSummaryRequest(req: LambdaRequest): void {
  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const carePlanInstanceId = req.pathParameters?.carePlanInstanceId?.trim();
  if (!carePlanInstanceId) {
    throwVal('carePlanInstanceId path parameter is required', 400, 'VALIDATION_ERROR');
  }

  const patientId = req.params?.patientId?.trim();
  if (!patientId) {
    throwVal('patientId query parameter is required', 400, 'VALIDATION_ERROR');
  }

  const workflowStage = parseOptionalEnum(
    req.params?.workflowStage,
    WORKFLOW_STAGE_VALUES,
    'workflowStage',
  );

  (req as LambdaRequest & { validatedGetTaskStatusSummary: ValidatedGetTaskStatusSummary })
    .validatedGetTaskStatusSummary = {
    orgId,
    patientId,
    carePlanInstanceId,
    workflowStage,
    authHeader: req.context.authHeader,
  };
}

export type ValidatedUpdateReminderSettings = {
  orgId: string;
  runtimeTaskInstanceId: string;
  body: UpdateReminderSettingsHttpBody;
  authHeader: string | undefined;
};

export function validateUpdateReminderSettingsRequest(req: LambdaRequest): void {
  const body = req.body as UpdateReminderSettingsHttpBody;

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const runtimeTaskInstanceId = req.pathParameters?.runtimeTaskInstanceId;
  if (!runtimeTaskInstanceId) {
    throwVal('runtimeTaskInstanceId path parameter is required', 400, 'VALIDATION_ERROR');
  }

  (req as LambdaRequest & { validatedUpdateReminderSettings: ValidatedUpdateReminderSettings })
    .validatedUpdateReminderSettings = {
    orgId,
    runtimeTaskInstanceId,
    body,
    authHeader: req.context.authHeader,
  };
}

export type ValidatedUpdateRuntimeTask = {
  orgId: string;
  runtimeTaskInstanceId: string;
  body: UpdateRuntimeTaskHttpBody;
  patch: import('@api-hub/task-core').RuntimeTaskMetadataPatch;
  authHeader: string | undefined;
};

export function validateUpdateRuntimeTaskRequest(req: LambdaRequest): void {
  const body = req.body as UpdateRuntimeTaskHttpBody;

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const runtimeTaskInstanceId = req.pathParameters?.runtimeTaskInstanceId;
  if (!runtimeTaskInstanceId) {
    throwVal('runtimeTaskInstanceId path parameter is required', 400, 'VALIDATION_ERROR');
  }

  const patch: import('@api-hub/task-core').RuntimeTaskMetadataPatch = {};
  for (const field of RUNTIME_TASK_METADATA_FIELDS) {
    if (body[field] !== undefined) {
      (patch as Record<string, unknown>)[field] = body[field];
    }
  }

  (req as LambdaRequest & { validatedUpdateRuntimeTask: ValidatedUpdateRuntimeTask })
    .validatedUpdateRuntimeTask = {
    orgId,
    runtimeTaskInstanceId,
    body,
    patch,
    authHeader: req.context.authHeader,
  };
}
