import { createLogger } from '@api-hub/logger';
import {
  AlertRepository,
  type AlertRecord,
  type CreateAlertInput,
  type UpdateAlertInput,
  type AlertState,
} from '@api-hub/alert-repository';
import { validatePatientContext } from './clients/user-service.client';
import { validateOrganizationContext } from './clients/organization-service.client';

const log = createLogger({ service: 'alert-service', redactPII: true });
const repo = new AlertRepository();

export class AlertService {
  async createAlert(input: CreateAlertInput, authHeader?: string): Promise<{ record: AlertRecord; duplicate: boolean }> {
    const existing = await repo.getByEventId(input.inputEventId);
    if (existing) {
      log.info('Idempotent replay for inputEventId', { inputEventId: input.inputEventId, alertId: existing.alertId });
      return { record: existing, duplicate: true };
    }

    await validatePatientContext(input.patientId, input.organizationId, authHeader);
    await validateOrganizationContext(input.organizationId, authHeader);

    try {
      const record = await repo.createAlert(input);
      return { record, duplicate: false };
    } catch (e: unknown) {
      const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';
      if (name === 'TransactionCanceledException') {
        const again = await repo.getByEventId(input.inputEventId);
        if (again) return { record: again, duplicate: true };
      }
      throw e;
    }
  }

  getAlert(alertId: string): Promise<AlertRecord | null> {
    return repo.getAlertById(alertId);
  }

  listPatientAlerts(
    patientId: string,
    q: { openOnly?: boolean; inputType?: string; limit?: number },
  ): Promise<AlertRecord[]> {
    return repo.queryPatientAlerts(patientId, q);
  }

  listOrgAlerts(
    organizationId: string,
    q: { state?: AlertState; limit?: number; unassignedOnly?: boolean },
  ): Promise<AlertRecord[]> {
    return repo.queryOrgAlerts(organizationId, q);
  }

  listUserAlerts(
    userId: string,
    q: { state?: AlertState; limit?: number },
  ): Promise<AlertRecord[]> {
    return repo.queryUserAlerts(userId, q);
  }

  updateAlert(alertId: string, patch: UpdateAlertInput): Promise<AlertRecord | null> {
    return repo.updateAlert(alertId, patch);
  }
}
