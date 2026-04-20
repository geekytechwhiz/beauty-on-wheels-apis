import { userCreatedEventSchema } from '../validation/event.validation';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventBridgeEvent } from 'aws-lambda';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { assignUserRole } from '../services/role.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const client = new EventBridgeClient({});
const EVENT_BUS = process.env.EVENT_BUS || 'user-service-bus';

export async function publishUserCreatedEvent(event: unknown): Promise<void> {
  const parsed = userCreatedEventSchema.parse(event);
  const logger = createChildLogger(baseLogger, { correlationId: parsed.correlationId, eventType: parsed.eventName });
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

type UserCreatedDetail = {
  eventName?: string;
  correlationId?: string;
  userId?: string;
  organizationID?: string;
  roleId?: string;
  name?: string;
  email?: string;
  phone?: string;
  profilePic?: string;
};

export const userCreatedRoleAssignment = async (
  event: EventBridgeEvent<'UserCreated.v1', UserCreatedDetail>,
): Promise<void> => {
  const detail = userCreatedEventSchema.parse(event?.detail ?? {});
  const logger = createChildLogger(baseLogger, {
    correlationId: detail.correlationId,
    userId: detail.userId,
    organizationID: detail.organizationID,
  });

  const roleId = String(detail.roleId ?? '');
  const organizationID = String(detail.organizationID ?? '');
  const userId = String(detail.userId ?? '');

  if (!roleId || !organizationID || !userId) {
    logger.info({
      event: 'userCreatedRoleAssignment_skipped',
      reason: 'missing_role_assignment_fields',
      hasRoleId: !!roleId,
      hasOrganizationID: !!organizationID,
      hasUserId: !!userId,
    });
    return;
  }

  const startedAt = Date.now();
  try {
    const assignmentResult = await assignUserRole(
      roleId,
      organizationID,
      userId,
      String(detail.name ?? ''),
      String(detail.email ?? ''),
      String(detail.phone ?? ''),
      String(detail.profilePic ?? ''),
    );

    if (assignmentResult && typeof assignmentResult === 'object' && 'success' in assignmentResult && !assignmentResult.success) {
      logger.warn({
        event: 'userCreatedRoleAssignment_unsuccessful',
        roleId,
        durationMs: Date.now() - startedAt,
        result: assignmentResult,
      });
      return;
    }

    logger.info({
      event: 'userCreatedRoleAssignment_success',
      roleId,
      durationMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    logger.error({
      event: 'userCreatedRoleAssignment_failed',
      roleId,
      durationMs: Date.now() - startedAt,
      err: serializeError(err),
    });
    throw err;
  }
};
