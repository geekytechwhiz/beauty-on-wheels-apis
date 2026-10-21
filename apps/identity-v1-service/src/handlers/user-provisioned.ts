import {
  createDefaultSqsDlqStrategy,
  onEvent,
  UserProvisionedEvent,
  type EventConsumerDeps,
  type UserProvisionedPayload,
} from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { getUserProvisioningService } from '../services/user-provisioning.service';

const logger = createLogger({ service: 'identity-user-provisioned', redactPII: true });
function consumerDeps(): Partial<EventConsumerDeps> {
  const strategy = createDefaultSqsDlqStrategy();
  return { retry: { maxAttempts: 3, strategy: 'exponential', delayMs: 200 }, dlq: strategy ? { enabled: true, strategy } : { enabled: false } };
}

export function createUserProvisionedHandler() {
  return onEvent({
    operation: 'identity.user.provisioned.processed',
    consumer: consumerDeps(),
    events: [{
      schema: UserProvisionedEvent,
      handler: async ({ meta, ...payload }) => {
        const event = payload as UserProvisionedPayload;
        try {
          const result = await getUserProvisioningService().linkUser(event.identityId, event.userId);
          logger.info({ event: 'identity_user_linked', identityId: event.identityId, userId: event.userId, eventId: meta.causationId, correlationId: meta.correlationId, result, provisioningStatus: 'LINKED' });
        } catch (error) {
          logger.error({ event: 'identity_user_link_conflict', identityId: event.identityId, userId: event.userId, errorCode: error instanceof Error ? error.name : 'UNKNOWN', correlationId: meta.correlationId });
          throw error;
        }
      },
    }],
  });
}

export const handler = createUserProvisionedHandler();
