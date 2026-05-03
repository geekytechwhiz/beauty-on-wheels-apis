/**
 * HTTP controllers for alert-service.
 *
 * **Flow:** `withLambdaHandler` builds context + optional schema validation → controller (authz, orchestration) →
 * {@link AlertService} (`@api-hub/alert-core`) → {@link AlertRepository}.
 *
 * **Responses:** shared `withLambdaHandler` success / {@link handleError} error envelopes (`@api-hub/utils`).
 */
import type { LambdaRequest } from '@api-hub/utils';
import { BaseError } from '@api-hub/utils';
import {
  AlertService,
  createAlertPayloadFromHttpBody,
  normalizeAlertServiceError,
  toAlertDetail,
  toPublicAlert,
  ALERT_STATE,
  type AlertState,
  type CreateAlertPayload,
} from '@api-hub/alert-core';
import { patchAlertBodySchema } from '../validators/alert.schemas';
import { parseListAlertsQuery, type ValidatedCreateAlert } from '../validators/request.validators';
import {
  getActorUserIdForRequest,
  getOrganizationIdForRequest,
} from '../utils/helpers';

let alertService: AlertService | undefined;
function getAlertService(): AlertService {
  if (!alertService) alertService = new AlertService();
  return alertService;
}

let ctrl: AlertHttpController | undefined;

function unauthorizedOrgError(): Error & { statusCode: number; code: string } {
  const e = new Error('Organization could not be resolved from the access token') as Error & {
    statusCode: number;
    code: string;
  };
  e.statusCode = 401;
  e.code = 'UNAUTHORIZED';
  return e;
}

export class AlertHttpController {
  private readonly svc = getAlertService();

  /**
   * POST /alerts — body validated by {@link validateCreateAlertRequest} in `withLambdaHandler`; tenant + actor
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

  async handleGetAlert(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) {
      throw Object.assign(new Error('alertId required'), { statusCode: 400, code: 'INVALID_REQUEST' });
    }
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) throw unauthorizedOrgError();
    const row = await this.svc.getAlert(alertId, orgId);
    if (!row) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });
    return toAlertDetail(row);
  }

  async handleGetAlertActivity(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) throw unauthorizedOrgError();

    const items = await this.svc.listAlertActivity(alertId, orgId);
    if (!items) throw Object.assign(new Error('Alert not found'), { statusCode: 404, code: 'NOT_FOUND' });

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

  async handleListOrgAlerts(req: LambdaRequest) {
    const organizationId = req.pathParameters?.organizationId;
    if (!organizationId) throw Object.assign(new Error('organizationId required'), { statusCode: 400 });
    const qp = req.params as Record<string, string | undefined>;
    const state = (qp.state as AlertState | undefined) ?? ALERT_STATE.UNASSIGNED;
    const unassignedOnly = qp.unassignedOnly === 'true' || qp.unassignedOnly === '1';
    const limit = qp.limit ? Number(qp.limit) : 50;
    const rows = await this.svc.listOrgAlerts(organizationId, { state, unassignedOnly, limit });
    return { items: rows.map(toPublicAlert) };
  }

  async handleListUserAlerts(req: LambdaRequest) {
    const userId = req.pathParameters?.userId;
    if (!userId) throw Object.assign(new Error('userId required'), { statusCode: 400 });
    const qp = req.params as Record<string, string | undefined>;
    const state = qp.state as AlertState | undefined;
    const limit = qp.limit ? Number(qp.limit) : 50;
    const rows = await this.svc.listUserAlerts(userId, { state, limit });
    return { items: rows.map(toPublicAlert) };
  }

  async handlePatchAlert(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) throw unauthorizedOrgError();

    const existing = await this.svc.getAlert(alertId, orgId);
    if (!existing) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });

    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
    const patch = patchAlertBodySchema.parse(raw) as {
      alertState?: AlertState;
      assignedToUserId?: string | null;
      slaBreachIndicator?: boolean;
    };
    const row = await this.svc.updateAlert(alertId, patch);
    if (!row) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });
    return { alert: toPublicAlert(row) };
  }
}

export function getAlertHttpController(): AlertHttpController {
  if (!ctrl) ctrl = new AlertHttpController();
  return ctrl;
}
