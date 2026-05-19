import { publishEvent } from '@api-hub/event-platform';
import { AlertCreatedEventSchema } from '../outbound/alert-created.event';
import { AlertStateChangedSchema } from '../outbound/alert-state-changed.event';

export async function publishAlertCreated(payload: any): Promise<void> {
  await publishEvent(AlertCreatedEventSchema, payload, {
    meta: {
      correlationId: payload.alertId,
      tenantId: payload.organizationId,
    },
  });
}

export async function publishAlertStateChanged(payload: any): Promise<void> {
  await publishEvent(AlertStateChangedSchema, payload, {
    meta: {
      correlationId: payload.alertId,
      tenantId: payload.organizationId,
    },
  });
}


