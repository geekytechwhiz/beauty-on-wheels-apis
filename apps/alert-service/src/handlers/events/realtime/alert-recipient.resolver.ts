import type { BaseEvent } from '@api-hub/event-platform';
import type { RecipientResolver } from '@api-hub/event-platform';

import type { AlertCreateIngestPayload } from '../inbound/alert-create-ingest.payload';
import {
  resolveAlertRealtimeNotifyScope,
  shouldResolveAlertRecipients,
} from './alert-realtime-notify-scope';

export class AlertRecipientResolver implements RecipientResolver {
  async resolve(event: BaseEvent<unknown>) {
    const payload = event.payload as AlertCreateIngestPayload;
    const scope = resolveAlertRealtimeNotifyScope(payload);

    if (!shouldResolveAlertRecipients(scope)) {
      return [];
    }

    const organizationId = payload.organizationId;
    const userIds = payload.notifyUserIds ?? [];

    return userIds
      .map((id) => id.trim())
      .filter(Boolean)
      .map((userId) => ({ userId, organizationId }));
  }
}

export const alertRecipientResolver = new AlertRecipientResolver();
