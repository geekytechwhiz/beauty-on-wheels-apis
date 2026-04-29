/**
 * HTTP controllers for alert-service.
 *
 * **HTTP → `getAlertService` → `AlertService` (`@api-hub/alert-integration`) → `AlertRepository`**
 *
 * **Responses:** {@link apiGatewayResponseOptions} from `@api-hub/utils` (same defaults as SSO `BaseController.errorResponse`).
 */
import type { LambdaRequest } from '@api-hub/utils';
import { BaseError } from '@api-hub/utils';
import type { AlertRecord, AlertState, CreateAlertPayload } from '@api-hub/alert-integration';
import {
  createAlertPayloadFromHttpBody,
  toAlertDetail,
  toPublicAlert,
} from '@api-hub/alert-integration';
import { getAlertService } from '../services/alert-app.service';
import { patchAlertBodySchema } from '../validators/alert.schemas';
import { parseListAlertsQuery, type ValidatedCreateAlert } from '../validation/request.validators';
import {
  getActorUserIdForRequest,
  getOrganizationIdForRequest,
} from '../utils/helpers';
import { normalizeAlertServiceError } from '../utils/alert-http-errors';

let ctrl: AlertHttpController | undefined;

type ListQueueKind = 'TEAM' | 'MY' | 'PATIENT';

function applyAlertListPostFilters(
  rows: AlertRecord[],
  organizationId: string,
  opts: {
    queue: ListQueueKind;
    priority?: string;
    inputType?: string;
    state?: AlertState;
    assignment?: 'UNASSIGNED' | 'ASSIGNED';
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  },
): AlertRecord[] {
  // TEAM list is already scoped by org on GSI1; MY / PATIENT need tenant filter on top of user/patient index.
  let items =
    opts.queue === 'TEAM'
      ? rows
      : rows.filter((a) => a.organizationId === organizationId);

  if (opts.priority?.trim()) {
    const p = opts.priority.trim();
    items = items.filter((a) => a.priority === p);
  }
  // PATIENT: inputType is applied in `queryPatientAlerts` — avoid duplicating here.
  if (opts.queue !== 'PATIENT' && opts.inputType?.trim()) {
    const t = opts.inputType.trim();
    items = items.filter((a) => a.inputType === t);
  }

  if (opts.queue === 'PATIENT' && opts.state) {
    items = items.filter((a) => a.alertState === opts.state);
  }

  if (opts.queue === 'TEAM' && opts.assignment === 'ASSIGNED') {
    items = items.filter((a) => !!a.assignedToUserId);
  }

  const fromTs = opts.dateFrom ? Date.parse(opts.dateFrom) : NaN;
  if (!Number.isNaN(fromTs)) {
    items = items.filter((a) => Date.parse(a.triggerTimestamp) >= fromTs);
  }
  const toTs = opts.dateTo ? Date.parse(opts.dateTo) : NaN;
  if (!Number.isNaN(toTs)) {
    items = items.filter((a) => Date.parse(a.triggerTimestamp) <= toTs);
  }

  const q = opts.search?.trim().toLowerCase();
  if (q) {
    items = items.filter(
      (a) =>
        a.alertId.toLowerCase().includes(q) ||
        a.triggerSummary.toLowerCase().includes(q) ||
        a.patientId.toLowerCase().includes(q),
    );
  }

  return items;
}

export class AlertHttpController {
  private readonly svc = getAlertService();

  /**
   * POST /alerts — body validated by {@link validateCreateAlertRequest} in the HTTP handler (`withLambdaHandler`).
   * Returns alert detail for both new create and idempotent replay; standard success envelope is **200** from
   * `withLambdaHandler` (no change to shared middleware). Service errors: {@link normalizeAlertServiceError} → throw → `handleError`.
   */
  async handleCreateAlert(req: LambdaRequest) {
    const requestLogger = req.context.logger!;
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
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) {
      const e = new Error('Organization could not be resolved from the access token') as Error & {
        statusCode: number;
        code?: string;
      };
      e.statusCode = 401;
      e.code = 'UNAUTHORIZED';
      throw e;
    }
    const row = await this.svc.getAlert(alertId, orgId);
    if (!row) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });
    return toAlertDetail(row);
  }

  async handleGetAlertActivity(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const authHeader = req.context.authHeader;
    const orgId = getOrganizationIdForRequest(req.event, authHeader);
    if (!orgId) {
      const e = new Error('Organization could not be resolved from the access token') as Error & {
        statusCode: number;
        code?: string;
      };
      e.statusCode = 401;
      e.code = 'UNAUTHORIZED';
      throw e;
    }

    const items = await this.svc.listAlertActivity(alertId, orgId);
    if (!items) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });

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
    if (!orgId) {
      const e = new Error('Organization could not be resolved from the access token') as Error & {
        statusCode: number;
        code?: string;
      };
      e.statusCode = 401;
      e.code = 'UNAUTHORIZED';
      throw e;
    }

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
    } = parseListAlertsQuery(req.params as Record<string, string | string[] | undefined>);
    const limit = Math.min(100, Math.max(1, pageSize ?? 20));

    let rows: AlertRecord[];

    if (queue === 'PATIENT') {
      rows = await this.svc.listPatientAlerts(patientId!, {
        inputType,
        limit,
        openOnly: false,
      });
    } else if (queue === 'MY') {
      const userId = getActorUserIdForRequest(event, authHeader);
      if (!userId) {
        throw Object.assign(new Error('User id could not be resolved for MY queue'), { statusCode: 400 });
      }
      rows = await this.svc.listUserAlerts(userId, { state, limit });
    } else {
      let orgState: AlertState;
      if (state) {
        orgState = state;
      } else if (assignment === 'ASSIGNED') {
        orgState = 'ASSIGNED';
      } else {
        orgState = 'UNASSIGNED';
      }
      const unassignedOnly = assignment === 'UNASSIGNED';
      rows = await this.svc.listOrgAlerts(orgId, {
        state: orgState,
        unassignedOnly,
        limit,
      });
    }

    rows = applyAlertListPostFilters(rows, orgId, {
      queue,
      priority,
      inputType,
      state,
      assignment: queue === 'TEAM' ? assignment : undefined,
      dateFrom,
      dateTo,
      search,
    });

    return { items: rows.map(toPublicAlert) };
  }

  async handleListOrgAlerts(req: LambdaRequest) {
    const organizationId = req.pathParameters?.organizationId;
    if (!organizationId) throw Object.assign(new Error('organizationId required'), { statusCode: 400 });
    const qp = req.params as Record<string, string | undefined>;
    const state = (qp.state as AlertState | undefined) ?? 'UNASSIGNED';
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

