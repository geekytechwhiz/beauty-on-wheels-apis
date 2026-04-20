import { userRoleAssignmentRequestedEventSchema } from '../validation/event.validation';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger, createChildLogger } from '@api-hub/logger';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const client = new EventBridgeClient({});
const EVENT_BUS = process.env.EVENT_BUS || 'user-service-bus';

export async function publishUserRoleAssignmentRequestedEvent(event: unknown): Promise<void> {
  const parsed = userRoleAssignmentRequestedEventSchema.parse(event);
  const logger = createChildLogger(baseLogger, {
    correlationId: parsed.correlationId,
    eventType: parsed.eventName,
    userId: parsed.userId,
    roleId: parsed.roleId,
    organizationID: parsed.organizationID,
  });
  logger.info({
    event: 'publishing_user_role_assignment_requested',
    message: 'Publishing UserRoleAssignmentRequested.v1',
  });
  console.log('[TEST][eventBridge] PutEvents start', {
    eventBus: EVENT_BUS,
    detailType: 'UserRoleAssignmentRequested.v1',
    source: 'user-service',
    correlationId: parsed.correlationId,
    userId: parsed.userId,
    roleId: parsed.roleId,
    organizationID: parsed.organizationID,
  });

  const putEventsResult = await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: EVENT_BUS,
          Source: 'user-service',
          DetailType: 'UserRoleAssignmentRequested.v1',
          Detail: JSON.stringify(parsed),
        },
      ],
    }),
  );
  console.log('[TEST][eventBridge] PutEvents result', {
    failedEntryCount: putEventsResult.FailedEntryCount ?? 0,
    entries: putEventsResult.Entries,
  });
}
