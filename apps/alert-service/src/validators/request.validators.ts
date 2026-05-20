import { AlertWorkflowAction } from '@api-hub/alert-core';
import { LambdaRequest } from '@api-hub/utils';
import {
  getActorUserIdForRequest,
  getOrganizationIdForRequest,
} from '../utils/helpers';
import {
  alertAssignmentBodySchema,
  alertPriorityBodySchema,
  alertWorkflowBodySchema,
   
  listAlertsQuerySchema,
  noteRequestBodySchema,
  type AlertAssignmentHttpBody,
  type AlertPriorityHttpBody,
  type AlertWorkflowHttpBody,
  type CreateAlertHttpBody,
  type ListAlertsQuery,
} from './alert.schemas';

/** Allowed `sourceType` values per `inputType` (must match {@link createAlertHttpBodySchema}). */
const SOURCE_TYPE_MAP: Record<string, string[]> = {
  MISSED_READING: ['MONITORING_SERVICE'],
  MISSING_DEVICE: ['DEVICE_MONITORING', 'DEVICE_WORKFLOW'],
};

function throwVal(
  message: string,
  statusCode = 400,
  code = 'VALIDATION_ERROR',
  details?: Array<{ field?: string; message: string }>,
): never {
  const err = new Error(message) as Error & {
    statusCode: number;
    code: string;
    details?: Array<{ field?: string; message: string }>;
  };
  err.statusCode = statusCode;
  err.code = code;
  if (details) err.details = details;
  throw err;
}

 

function validateSourceAgainstInput(inputType: string, sourceType: string) {
  const allowed = SOURCE_TYPE_MAP[inputType];

  if (!allowed) {
    throwVal('Unsupported inputType', 422, 'VALIDATION_ERROR', [
      { field: 'inputType', message: `Unsupported inputType: ${inputType}` },
    ]);
  }

  if (!allowed.includes(sourceType)) {
    throwVal('Invalid sourceType for inputType', 422, 'VALIDATION_ERROR', [
      {
        field: 'sourceType',
        message: `sourceType '${sourceType}' is not allowed for inputType '${inputType}'`,
      },
    ]);
  }
}

export type ValidatedCreateAlert = {
  orgId: string;
  actorUserId: string | undefined;
  body: CreateAlertHttpBody;
  authHeader: string | undefined;
};

export type CoreWorkflowAction = AlertWorkflowAction;

/** Parsed + normalized POST `/alerts/{alertId}/workflow` input for {@link AlertService.applyWorkflowMutation}. */
export type ValidatedWorkflow = {
  orgId: string;
  alertIds: string[];
  authHeader: string | undefined;
  action: CoreWorkflowAction;
  assignToUserId?: string;
  assigneeDisplayName?: string;
  /** HTTP `reasonCode` for RESOLVE / DISMISS only. */
  reasonCode?: string;
  comment?: string;
  closureComment?: string;
  performedByDisplayName: string;
};

export type AssignmentAction = AlertAssignmentHttpBody['action'];

export type ValidatedAssignment = {
  orgId: string;
  alertIds: string[];
  authHeader: string | undefined;
  action: AssignmentAction;
  assignToUserId?: string;
  assigneeDisplayName?: string;
  performedByDisplayName: string;
};

export type ValidatedPriority = {
  orgId: string;
  alertIds: string[];
  authHeader: string | undefined;
  priority: AlertPriorityHttpBody['priority'];
  performedByDisplayName: string;
};

export type ValidatedNote = {
  orgId: string;
  alertId: string;
  authHeader: string | undefined;
  comment: string;
  performedByDisplayName: string;
};

function mapWorkflowHttpToCore(body: AlertWorkflowHttpBody): Omit<ValidatedWorkflow, 'orgId' | 'alertIds' | 'authHeader'> {
  const {
    comment,
    closureComment,
    reasonCode,
    assignedToUserId,
    performedByDisplayName,
    assigneeDisplayName,
  } = body;
  switch (body.action) {
    case 'ASSIGN':
      return {
        action: AlertWorkflowAction.Assign,
        assignToUserId: assignedToUserId as string,
        assigneeDisplayName,
        comment,
        closureComment,
        performedByDisplayName,
      };
    case 'MOVE_TO_WAITING':
      return { action: AlertWorkflowAction.MoveToWaiting, comment, closureComment, performedByDisplayName };
    case 'RESUME_WORK':
      return { action: AlertWorkflowAction.ResumeWork, comment, closureComment, performedByDisplayName };
    case 'START_WORK':
      return {
        action: AlertWorkflowAction.StartWork,
        comment,
        closureComment,
        performedByDisplayName,
      };
    case 'RESOLVE':
      return {
        action: AlertWorkflowAction.Resolve,
        reasonCode,
        comment,
        closureComment,
        performedByDisplayName,
      };
    case 'DISMISS':
      return {
        action: AlertWorkflowAction.Dismiss,
        reasonCode,
        comment,
        closureComment,
        performedByDisplayName,
      };
    default: {
      const _exhaustive: never = body.action;
      return _exhaustive;
    }
  }
}

export function validateWorkflowRequest(req: LambdaRequest): void {
  const result = alertWorkflowBodySchema.safeParse(req.body);

  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
    );
  }

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const mapped = mapWorkflowHttpToCore(result.data);
  (req as LambdaRequest & { validatedWorkflow: ValidatedWorkflow }).validatedWorkflow = {
    orgId,
    alertIds: result.data.alertIds,
    authHeader: req.context.authHeader,
    ...mapped,
  };
}

export function validateAssignmentRequest(req: LambdaRequest): void {
  const result = alertAssignmentBodySchema.safeParse(req.body);

  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
    );
  }

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const actorUserId = getActorUserIdForRequest(req.event, req.context.authHeader);

  const assignToUserId =
    result.data.action === 'ASSIGN_TO_SELF'
      ? actorUserId?.trim()
      : result.data.assignToUserId?.trim();

  if (result.data.action === 'ASSIGN_TO_SELF' && !assignToUserId) {
    throwVal('User id could not be resolved for ASSIGN_TO_SELF', 401, 'UNAUTHORIZED');
  }

  (req as LambdaRequest & { validatedAssignment: ValidatedAssignment }).validatedAssignment = {
    orgId,
    alertIds: result.data.alertIds,
    authHeader: req.context.authHeader,
    action: result.data.action,
    ...(assignToUserId ? { assignToUserId } : {}),
    assigneeDisplayName: result.data.assigneeDisplayName,
    performedByDisplayName: result.data.performedByDisplayName,
  };
}

export function validatePriorityRequest(req: LambdaRequest): void {
  const result = alertPriorityBodySchema.safeParse(req.body);

  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
    );
  }

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  (req as LambdaRequest & { validatedPriority: ValidatedPriority }).validatedPriority = {
    orgId,
    alertIds: result.data.alertIds,
    authHeader: req.context.authHeader,
    priority: result.data.priority,
    performedByDisplayName: result.data.performedByDisplayName,
  };
}

export function validateCreateAlertRequest(req: LambdaRequest): void {
  const body = req.body;
 
  validateSourceAgainstInput(body.inputType, body.sourceType);

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const actorUserId = getActorUserIdForRequest(req.event, req.context.authHeader);
  (req as LambdaRequest & { validatedCreateAlert: ValidatedCreateAlert }).validatedCreateAlert = {
    orgId,
    actorUserId,
    body: body,
    authHeader: req.context.authHeader,
  };
}

export function parseListAlertsQuery(
  qp: Record<string, string | string[] | undefined>,
): ListAlertsQuery {
  const first = (v: string | string[] | undefined): string | undefined => {
    if (v === undefined || v === null) return undefined;
    return Array.isArray(v) ? v[0] : v;
  };

  const raw = {
    queue: first(qp.queue),
    patientId: first(qp.patientId),
    state: first(qp.state),
    assignment: first(qp.assignment),
    priority: first(qp.priority),
    inputType: first(qp.inputType),
    dateFrom: first(qp.dateFrom),
    dateTo: first(qp.dateTo),
    search: first(qp.search),
    pageSize: first(qp.pageSize),
    nextToken: first(qp.nextToken),
  };

  const result = listAlertsQuerySchema.safeParse(raw);

  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({
        field: i.path.join('.') || undefined,
        message: i.message,
      })),
    );
  }

  return result.data;
}

export function validateAddNoteRequest(req: LambdaRequest): void {
  const raw = req.body;
  const result = noteRequestBodySchema.safeParse(raw);
  if (!result.success) {
    throwVal(
      result.error.issues[0]?.message ?? 'Validation failed',
      422,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => ({ field: i.path.join('.') || undefined, message: i.message })),
    );
  }

  const orgId = getOrganizationIdForRequest(req.event, req.context.authHeader);
  if (!orgId) {
    throwVal('Organization could not be resolved from the access token', 401, 'UNAUTHORIZED');
  }

  const alertId = req.pathParameters?.alertId;
  if (!alertId) throwVal('alertId required', 400, 'INVALID_REQUEST');

  (req as LambdaRequest & { validatedNote?: ValidatedNote }).validatedNote = {
    orgId,
    alertId,
    authHeader: req.context.authHeader,
    comment: result.data.comment,
    performedByDisplayName: result.data.performedByDisplayName,
  };
}