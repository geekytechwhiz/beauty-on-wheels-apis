import {
  createDynamoStreamHandler,
  IdentityRegisteredEvent,
  type IdentityRegisteredPayload,
} from '@api-hub/event-platform';
import { createLogger } from '@api-hub/observability';

import { mapIdentityProfileInsertStreamRecord } from '../events/map-identity-profile-stream';
import { getUserProvisioningService } from '../services/user-provisioning.service';

const logger = createLogger({ service: 'identity-profile-stream', redactPII: true });

export function createIdentityProfileStreamHandler() {
  return createDynamoStreamHandler({
    operation: 'identity.registered.processed',
    consumer: { mapRawToBaseEvent: mapIdentityProfileInsertStreamRecord },
    events: [{
      table: 'identity-table',
      eventName: ['INSERT'],
      schema: IdentityRegisteredEvent,
      handler: async ({ meta, ...payload }) => {
        console.log('identity_registered_handler', {
          meta,
          payload,
        });
        const streamPayload = payload as IdentityRegisteredPayload;
        const published = await getUserProvisioningService().publishRegistration(streamPayload.identityId, meta.correlationId);
        logger.info({ event: 'identity_registered', identityId: streamPayload.identityId, correlationId: meta.correlationId, published });
      },
    }],
  });
}

export const handler = createIdentityProfileStreamHandler();
