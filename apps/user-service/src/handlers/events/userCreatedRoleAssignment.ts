import { EventBridgeEvent } from 'aws-lambda';
import { createChildLogger, createLogger, serializeError } from '@api-hub/logger';
import { assignUserRole } from '../../services/role.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

type UserCreatedDetail = {
  correlationId?: string;
  userId?: string;
  organizationID?: string;
  roleId?: string;
  name?: string;
  email?: string;
  phone?: string;
  profilePic?: string;
};

export const main = async (
  event: EventBridgeEvent<'UserCreated.v1', UserCreatedDetail>,
): Promise<void> => {
  const detail = event?.detail ?? {};
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
    await assignUserRole(
      roleId,
      organizationID,
      userId,
      String(detail.name ?? ''),
      String(detail.email ?? ''),
      String(detail.phone ?? ''),
      String(detail.profilePic ?? ''),
    );

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
