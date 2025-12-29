import { userDeletedEventSchema } from '../validation/event.validation';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const client = new EventBridgeClient({});
const EVENT_BUS = process.env.EVENT_BUS || 'user-service-bus';

export async function publishUserDeletedEvent(event: unknown): Promise<void> {
  const parsed = userDeletedEventSchema.parse(event);
  const logger = createChildLogger(baseLogger, { correlationId: parsed.correlationId, eventType: parsed.eventName });
  logger.info({ event: 'publishing_userDeleted', message: 'Publishing UserDeleted.v1' });
  await client.send(new PutEventsCommand({
    Entries: [{   
      EventBusName: EVENT_BUS,
      Source: 'user-service',
      DetailType: 'UserDeleted.v1',
      Detail: JSON.stringify(parsed),
    }],
  }));
}
