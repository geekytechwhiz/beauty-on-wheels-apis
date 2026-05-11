import { publishEvent } from '@api-hub/event-platform';
import { AlertCreatedEventSchema } from '../outbound/alert-created.event';

export async function publishAlertCreated(payload: any): Promise<void> {
  await publishEvent(AlertCreatedEventSchema, payload, {
    meta: {
      correlationId: payload.alertId,
      tenantId: payload.organizationId,
    },
  });
}
