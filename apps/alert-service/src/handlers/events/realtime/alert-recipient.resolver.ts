import type { BaseEvent } from '@api-hub/event-platform';
import type { RecipientResolver } from '@api-hub/event-platform';

import type { AlertCreateIngestPayload } from '../inbound/alert-create-ingest.payload';

/** Dev placeholder until dynamic recipient lookup (assignee, org queue, etc.). */
const DUMMY_ALERT_REALTIME_USER_IDS = ['test-user-1', 'test-user-2'] as const;

export class AlertRecipientResolver implements RecipientResolver {
  async resolve(event: BaseEvent<unknown>) {
    const payload = event.payload as AlertCreateIngestPayload;
    const organizationId = payload.organizationId;

    return DUMMY_ALERT_REALTIME_USER_IDS.map((userId) => ({
      userId,
      organizationId,
    }));
  }
}

export const alertRecipientResolver = new AlertRecipientResolver();
