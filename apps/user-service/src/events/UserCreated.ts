import { userCreatedEventSchema } from '../validation/event.validation';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger, createChildLogger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const client = new EventBridgeClient({});
const EVENT_BUS = process.env.EVENT_BUS || 'user-service-bus';

export async function publishUserCreatedEvent(event: unknown): Promise<void> {
  const parsed = userCreatedEventSchema.parse(event);
  const logger = createChildLogger(baseLogger, { correlationId: parsed.correlationId, eventType: 'UserCreated.v1' });
  logger.info({ event: 'publishing_userCreated', message: 'Publishing UserCreated.v1' });
  
  await client.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS,
      Source: 'user-service',
      DetailType: 'UserCreated.v1',
      Detail: JSON.stringify(parsed),
    }],
  }));
}
