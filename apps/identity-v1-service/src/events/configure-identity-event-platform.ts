import {
  configureEventPlatform,
  EventBridgeAdapter,
  IdentityRegisteredEvent,
  IDENTITY_REGISTERED_EVENT_TYPE,
  IDENTITY_USER_PROVISIONING_EVENT_VERSION,
  UserProvisionedEvent,
  USER_PROVISIONED_EVENT_TYPE,
} from '@api-hub/event-platform';

import { env } from '../configs/env.config';

let configured = false;

export function ensureIdentityEventPlatform(): void {
  if (configured) return;
  if (!env.EVENT_BUS_NAME.trim()) throw new Error('EVENT_BUS_NAME is required to publish identity events');
  configureEventPlatform({
    publishers: {
      eventbridge: new EventBridgeAdapter({ eventBusName: env.EVENT_BUS_NAME, source: 'identity-service' }),
    },
    payloadSchemas: {
      [IDENTITY_REGISTERED_EVENT_TYPE]: { [IDENTITY_USER_PROVISIONING_EVENT_VERSION]: IdentityRegisteredEvent },
      [USER_PROVISIONED_EVENT_TYPE]: { [IDENTITY_USER_PROVISIONING_EVENT_VERSION]: UserProvisionedEvent },
    },
  });
  configured = true;
}

export function resetIdentityEventPlatformForTests(): void { configured = false; }
