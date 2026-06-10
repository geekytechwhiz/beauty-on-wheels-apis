import type { LambdaRequest } from '@api-hub/utils';

import {
  CARE_PLAN_SYSTEM_ACTOR,
  manualSystemActor,
  SERVICE_FLOW_SYSTEM_ACTOR,
  TASK_HISTORY_DEFAULT_PAGE_SIZE,
  TASK_HISTORY_MAX_PAGE_SIZE,
} from '@api-hub/task-core';

import { getActorUserIdForRequest, getOrganizationIdForRequest } from '../utils/helpers';
import type {
  CreateMonitoringActionHttpBody,
  CreateRuntimeTaskHttpBody,
  GenerateCarePlanTasksHttpBody,
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

function parseHistoryPageSize(raw: string | undefined): number {
  if (!raw?.trim()) return TASK_HISTORY_DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throwVal('pageSize must be a positive integer', 400, 'VALIDATION_ERROR');
  }
  if (n > TASK_HISTORY_MAX_PAGE_SIZE) {
    throwVal(`pageSize must not exceed ${TASK_HISTORY_MAX_PAGE_SIZE}`, 400, 'VALIDATION_ERROR');
  }
  return n;
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

  const pageSize = parseHistoryPageSize(req.params?.pageSize);
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
