import type { LambdaRequest } from '@api-hub/utils';
import type { AlertState } from '@api-hub/alert-integration';
import { toPublicAlert } from '../mappers/alert-public.mapper';
import { getAlertService } from '../services/alert-app.service';
import { createAlertBodySchema, patchAlertBodySchema } from '../validators/alert.schemas';

let ctrl: AlertHttpController | undefined;

export class AlertHttpController {
  private readonly svc = getAlertService();

  async handleCreateAlert(req: LambdaRequest) {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
    const input = createAlertBodySchema.parse(raw);
    const authHeader = req.context.authHeader;
    const { record, duplicate } = await this.svc.createAlert(input, authHeader);
    return { alert: toPublicAlert(record), duplicate };
  }

  async handleGetAlert(req: LambdaRequest) {
    const alertId = req.pathParameters?.alertId;
    if (!alertId) throw Object.assign(new Error('alertId required'), { statusCode: 400 });
    const row = await this.svc.getAlert(alertId);
    if (!row) throw Object.assign(new Error('Alert not found'), { statusCode: 404 });
    return { alert: toPublicAlert(row) };
  }

  async handleListPatientAlerts(req: LambdaRequest) {
    const patientId = req.pathParameters?.patientId;
    if (!patientId) throw Object.assign(new Error('patientId required'), { statusCode: 400 });
    const qp = req.params as Record<string, string | undefined>;
    const openOnly = qp.openOnly === 'true' || qp.openOnly === '1';
    const inputType = qp.inputType;
    const limit = qp.limit ? Number(qp.limit) : 50;
    const rows = await this.svc.listPatientAlerts(patientId, { openOnly, inputType, limit });
    return { items: rows.map(toPublicAlert) };
  }

  async handleListOrgAlerts(req: LambdaRequest) {
    const organizationId = req.pathParameters?.organizationId;
    if (!organizationId) throw Object.assign(new Error('organizationId required'), { statusCode: 400 });
    const qp = req.params as Record<string, string | undefined>;
    const state = (qp.state as AlertState | undefined) ?? 'OPEN';
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
