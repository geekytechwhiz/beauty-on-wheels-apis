import { userRoleAssignmentRequestedEventSchema } from '../validation/event.validation';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { createLogger, createChildLogger } from '@api-hub/observability';

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

  const result = await client.send(
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

  const failedCount = result.FailedEntryCount ?? 0;
  if (failedCount > 0) {
    logger.error({
      event: 'publish_user_role_assignment_requested_failed',
      message: 'EventBridge PutEvents failed for one or more entries',
      failedEntryCount: failedCount,
      entries: result.Entries,
      eventBus: EVENT_BUS,
    });
    throw new Error('EventBridge PutEvents returned failed entries');
  }

  logger.info({
    event: 'publish_user_role_assignment_requested_success',
    message: 'UserRoleAssignmentRequested.v1 published successfully',
    eventBus: EVENT_BUS,
  });
}
