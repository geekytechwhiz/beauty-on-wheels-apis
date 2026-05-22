import type { BaseEvent } from '@api-hub/event-platform';
import type { RecipientResolver } from '@api-hub/event-platform';

import type { AlertCreateIngestPayload } from '../inbound/alert-create-ingest.payload';

 
export class AlertRecipientResolver implements RecipientResolver {
  async resolve(event: BaseEvent<unknown>) {
    const payload = event.payload as AlertCreateIngestPayload;
    const organizationId = payload.organizationId;

    // Example: notify org-wide alert watchers — replace with real lookup.
    const watcherUserIds = process.env.ALERT_REALTIME_WATCHER_USER_IDS?.split(',')
      .map((id) => id.trim())
      .filter(Boolean) ?? [];

    return watcherUserIds.map((userId) => ({
      userId,
      organizationId,
    }));
  }
}

export const alertRecipientResolver = new AlertRecipientResolver();
