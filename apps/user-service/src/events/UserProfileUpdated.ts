import { userProfileUpdatedEventSchema } from '../validation/event.validation';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const client = new EventBridgeClient({});
const EVENT_BUS = process.env.EVENT_BUS || 'user-service-bus';

export async function publishUserProfileUpdatedEvent(event: any) {
  const parsed = userProfileUpdatedEventSchema.parse(event);
  const logger = createChildLogger(baseLogger, { correlationId: parsed.correlationId, eventType: parsed.eventName });
  
  logger.info({ event: 'publishUserProfileUpdatedEvent', message: 'Publishing UserProfileUpdated.v1' });
  
  await client.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS,
      Source: 'user-service',
      DetailType: 'UserProfileUpdated.v1',
      Detail: JSON.stringify(parsed),
    }],
  }));
}
