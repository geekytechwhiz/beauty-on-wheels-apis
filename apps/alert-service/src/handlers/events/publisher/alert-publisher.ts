import { configureEventRuntime } from '../bootstrap/event-runtime';
import { publishEvent } from '@api-hub/event-platform';
import { AlertCreatedEventSchema } from '../outbound/alert-created.event';
import { AlertStateChangedSchema } from '../outbound/alert-state-changed.event';

export async function publishAlertCreated(payload: {
  alertId: string;
  patientId: string;
  organizationId: string;
  priority: 'P0' | 'P1' | 'P2';
  state: 'UNASSIGNED' | 'ASSIGNED';
  createdAt: string;
}): Promise<void> {
  configureEventRuntime();
  await publishEvent(AlertCreatedEventSchema, payload, {
    meta: {
      correlationId: payload.alertId,
      tenantId: payload.organizationId,
    },
  });
}

export async function publishAlertStateChanged(payload: {
  alertId: string;
  patientId: string;
  orgId: string;
  previousState: string;
  currentState: string;
  changedBy: string;
  changedAt: string;
}): Promise<void> {
  configureEventRuntime();
  await publishEvent(AlertStateChangedSchema, payload, {
    meta: {
      correlationId: payload.alertId,
      tenantId: payload.orgId,
    },
  });
}


