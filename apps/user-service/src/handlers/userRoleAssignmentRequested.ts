import type { EventBridgeEvent } from 'aws-lambda';
import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import { assignUserRole } from '../services/role.service';
import { userRoleAssignmentRequestedEventSchema } from '../validation/event.validation';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

type UserRoleAssignmentRequestedEvent = EventBridgeEvent<'UserRoleAssignmentRequested.v1', unknown>;

export const handler = async (event: UserRoleAssignmentRequestedEvent) => {
  const start = Date.now();
  const parsed = userRoleAssignmentRequestedEventSchema.parse(event.detail);
  const log = createChildLogger(baseLogger, {
    correlationId: parsed.correlationId,
    userId: parsed.userId,
    roleId: parsed.roleId,
    organizationID: parsed.organizationID,
  });

  log.info({
    event: 'user_role_assignment_event_received',
    detailType: event['detail-type'],
    source: event.source,
  });

  try {
    await assignUserRole(
      parsed.roleId,
      parsed.organizationID,
      parsed.userId,
      parsed.name,
      parsed.email,
      parsed.phone ?? '',
      parsed.profilePic ?? '',
      parsed.authHeader,
    );
    log.info({
      event: 'user_role_assignment_event_success',
      durationMs: Date.now() - start,
    });
  } catch (err) {
    log.error({
      event: 'user_role_assignment_event_failed',
      durationMs: Date.now() - start,
      err: serializeError(err),
    });
    throw err;
  }
};
