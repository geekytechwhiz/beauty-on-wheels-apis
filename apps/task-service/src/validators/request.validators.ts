import type { LambdaRequest } from '@api-hub/utils';

import {
  CARE_PLAN_SYSTEM_ACTOR,
  manualSystemActor,
  SERVICE_FLOW_SYSTEM_ACTOR,
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
