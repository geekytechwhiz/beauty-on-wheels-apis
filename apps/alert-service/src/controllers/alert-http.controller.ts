/**
 * HTTP controllers for alert-service.
 *
 * **Flow:** `withApiHandler` builds context + optional schema validation → controller (authz, orchestration) →
 * {@link AlertService} (`@api-hub/alert-core`) → {@link AlertRepository}.
 *
 * **Responses:** shared `withApiHandler` success / {@link handleError} error envelopes (`@api-hub/utils`).
 */
import type { LambdaRequest }  from '@api-hub/middleware';
import { BaseError }  from '@api-hub/middleware';
import {
  AlertService,
  createAlertPayloadFromHttpBody,
  normalizeAlertServiceError,
  toAlertDetail,
  toPublicAlert,
  type CreateAlertPayload,
  type WorkflowInput,
} from '@api-hub/alert-core';
import {
  parseListAlertsQuery,
  type ValidatedCreateAlert,
  type ValidatedNote,
  type ValidatedAssignment,
  type ValidatedPriority,
  type ValidatedWorkflow,
} from '../validators/request.validators';
import { getActorUserIdForRequest, getOrganizationIdForRequest } from '../utils/helpers';

let alertService: AlertService | undefined;
function getAlertService(): AlertService {
  if (!alertService) alertService = new AlertService();
  return alertService;
}

let ctrl: AlertHttpController | undefined;

function unauthorizedOrgError(): BaseError {
  return new BaseError(
    'Organization could not be resolved from the access token',
    401,
    'UNAUTHORIZED',
    [{ message: 'Organization could not be resolved from the access token' }],
    { retryable: false },
  );
}

export class AlertHttpController {
  private readonly svc = getAlertService();

  /**
   * POST /alerts — body validated by {@link validateCreateAlertRequest} in `withApiHandler`; tenant + actor
   * attached there as {@link ValidatedCreateAlert}.
   */
  async handleCreateAlert(req: LambdaRequest) {
    const requestLogger = req.context.logger;
    if (!requestLogger) {
      throw new BaseError(
        'Logger missing from request context',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Logger missing from request context' }],
      );
    }
    const correlationId = req.context.correlationId as string;

    const v = (req as LambdaRequest & { validatedCreateAlert?: ValidatedCreateAlert }).validatedCreateAlert;
    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const createInput = createAlertPayloadFromHttpBody(
      v.orgId,
      v.actorUserId,
      v.body as Omit<CreateAlertPayload, 'organizationId' | 'actorUserId'>,
    );

    try {
      const { record } = await this.svc.createAlert(createInput, v.authHeader);
      return toAlertDetail(record);
    } catch (e: unknown) {
      normalizeAlertServiceError(e, {
        logger: requestLogger,
        correlationId,
        organizationId: v.orgId,
        logEvent: 'create_alert_error',
      });
    }
  }

  /**
   * POST `/alerts/workflow` — body validated by {@link validateWorkflowRequest}; calls
   * {@link AlertService.applyWorkflow} and returns bulk result.
   */
  async handleUpdateAlertWorkflow(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedWorkflow?: ValidatedWorkflow }).validatedWorkflow;
    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const performedByUserId = getActorUserIdForRequest(req.event, v.authHeader);

    const input: WorkflowInput = {
      alertIds: v.alertIds,
      action: v.action,
      assignToUserId: v.assignToUserId,
      assigneeDisplayName: v.assigneeDisplayName,
      reasonCode: v.reasonCode,
      comment: v.comment,
      closureComment: v.closureComment,
      performedByUserId: performedByUserId ?? undefined,
      performedByDisplayName: v.performedByDisplayName,
    };

    const result = await this.svc.applyWorkflow(v.orgId, input);

    if (result.failed.length > 0 && result.succeeded.length === 0) {
      const f = result.failed[0];
      if (f.code === 'NOT_FOUND') {
        throw Object.assign(new Error(f.message), { statusCode: 404, code: 'NOT_FOUND' });
      }
      if (f.code === 'ILLEGAL_TRANSITION') {
        throw Object.assign(new Error(f.message), { statusCode: 409, code: 'ILLEGAL_TRANSITION' });
      }
      throw Object.assign(new Error(f.message), {
        statusCode: 422,
        code: f.code || 'WORKFLOW_ERROR',
      });
    }

    return {
      alertIds: v.alertIds,
      succeeded: result.succeeded,
      failed: result.failed,
    };
  }

  /**
   * POST `/alerts/assignment` — body validated by {@link validateAssignmentRequest}; calls
   * `AlertService.applyAssignment(...)` and returns updated {@link toAlertDetail} when one id was requested.
   * For multi-select, returns `{ alertIds }` on success (all-or-nothing).
   */
  async handleUpdateAlertAssignment(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedAssignment?: ValidatedAssignment }).validatedAssignment;
    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const performedByUserId = getActorUserIdForRequest(req.event, v.authHeader);

    const result = await this.svc.applyAssignment(v.orgId, {
      alertIds: v.alertIds,
      action: v.action,
      ...(v.assignToUserId ? { assignToUserId: v.assignToUserId } : {}),
      performedByUserId: performedByUserId ?? undefined,
      performedByDisplayName: v.performedByDisplayName,
      assigneeDisplayName: v.assigneeDisplayName,
    });

    void result;
    return { alertIds: v.alertIds };
  }

  /**
   * PATCH `/alerts/priority` — body validated by {@link validatePriorityRequest}; calls
   * `AlertService.applyPriority(...)` and returns updated {@link toAlertDetail} when one id was requested.
   * For multi-select, returns `{ alertIds }` on success (all-or-nothing).
   */
  async handleUpdateAlertPriority(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedPriority?: ValidatedPriority }).validatedPriority;
    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    const performedByUserId = getActorUserIdForRequest(req.event, v.authHeader);

    const result = await this.svc.applyPriority(v.orgId, {
      alertIds: v.alertIds,
      priority: v.priority,
      performedByUserId: performedByUserId ?? undefined,
      performedByDisplayName: v.performedByDisplayName,
    });

    void result;
    return { alertIds: v.alertIds };
  }

  async handleGetAlert(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) {
      throw new BaseError('alertId required', 400, 'INVALID_REQUEST', [
        { message: 'alertId required' },
      ], { retryable: false });
    }
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) throw unauthorizedOrgError();
    const row = await this.svc.getAlert(alertId, orgId);
    if (!row) {
      throw new BaseError('Alert not found', 404, 'NOT_FOUND', [{ message: 'Alert not found' }], {
        retryable: false,
      });
    }
    return toAlertDetail(row);
  }

  async handleGetAlertActivity(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) {
      throw new BaseError('alertId required', 400, 'INVALID_REQUEST', [
        { message: 'alertId required' },
      ], { retryable: false });
    }
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) throw unauthorizedOrgError();

    const notesOnly = (req.params as { notesOnly?: string }).notesOnly === 'true';

    const items = await this.svc.listAlertActivity(alertId, orgId, { notesOnly });
    return { items };
  }

  /**
   * GET /alerts — `queue=TEAM` (default), `MY`, or `PATIENT`. For `PATIENT`, `patientId` is required; for `TEAM`/`MY`,
   * `patientId` must be omitted (use `queue=PATIENT` for patient timeline).
   */
  async handleListAlerts(req: LambdaRequest) {
    const event = req.event;
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(event, authHeader);
    if (!orgId) throw unauthorizedOrgError();

    const {
      queue,
      patientId,
      state,
      assignment,
      priority,
      inputType,
      dateFrom,
      dateTo,
      search,
      pageSize,
      nextToken,
    } = parseListAlertsQuery(req.params as Record<string, string | string[] | undefined>);
    const limit = Math.min(100, Math.max(1, pageSize ?? 20));
    const actorUserId = getActorUserIdForRequest(event, authHeader);

    const { items, nextToken: nextPageToken } = await this.svc.listAlerts({
      organizationId: orgId,
      actorUserId,
      queue,
      patientId,
      state,
      assignment,
      priority,
      inputType,
      dateFrom,
      dateTo,
      search,
      limit,
      nextToken,
    });

    return {
      items: items.map(toPublicAlert),
      ...(nextPageToken ? { nextToken: nextPageToken } : {}),
    };
  }

  async handleAddAlertNote(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedNote?: ValidatedNote }).validatedNote;
    if (!v) {
      throw new BaseError('Request was not validated before controller', 500, 'INTERNAL_ERROR', [
        { message: 'Request was not validated before controller' },
      ]);
    }

    const performedByUserId = getActorUserIdForRequest(req.event, v.authHeader);

    // Call core service to add a note. Expect the core to return the created activity record or similar.
    // Use a best-effort call name `addNote` on the service.
    const activity = await this.svc.addNote(
      v.alertId,
      v.orgId,
      v.comment,
      performedByUserId ?? undefined,
      v.performedByDisplayName,
    );

    return activity;
  }
}

export function getAlertHttpController(): AlertHttpController {
  if (!ctrl) ctrl = new AlertHttpController();
  return ctrl;
}
