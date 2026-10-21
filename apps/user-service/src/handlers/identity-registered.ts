import {
  createDefaultSqsDlqStrategy,
  onEvent,
  publishEvent,
  IdentityRegisteredEvent,
  type EventConsumerDeps,
  type IdentityRegisteredPayload,
  UserProvisionedEvent,
  userProvisionedIdempotencyKey,
} from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { ensureUserEventPlatform } from '../events/configure-user-event-platform';
import { getIdentityProvisioningService } from '../services/identity-provisioning.service';

const logger = createLogger({ service: 'user-identity-registered', redactPII: true });

function consumerDeps(): Partial<EventConsumerDeps> {
  const strategy = createDefaultSqsDlqStrategy();
  return { retry: { maxAttempts: 3, strategy: 'exponential', delayMs: 200 }, dlq: strategy ? { enabled: true, strategy } : { enabled: false } };
}

export function createIdentityRegisteredHandler() {
  return onEvent({
    operation: 'user.identity.registered.processed',
    consumer: consumerDeps(),
    events: [{
      schema: IdentityRegisteredEvent,
      handler: async ({ meta, ...payload }) => {
        const event = payload as IdentityRegisteredPayload;
        const startedAt = Date.now();
        logger.info({ event: 'user_provisioning_started', identityId: event.identityId, eventId: meta.causationId, correlationId: meta.correlationId });
        const result = await getIdentityProvisioningService().ensureUserForIdentity(event);
        ensureUserEventPlatform();
        await publishEvent(UserProvisionedEvent, result, {
          idempotencyKey: userProvisionedIdempotencyKey(result.identityId, result.userId),
          meta: { correlationId: meta.correlationId, causationId: meta.causationId },
        });
        logger.info({ event: 'user_provisioning_completed', ...result, correlationId: meta.correlationId, processingDurationMs: Date.now() - startedAt });
      },
    }],
  });
}

export const handler = createIdentityRegisteredHandler();
