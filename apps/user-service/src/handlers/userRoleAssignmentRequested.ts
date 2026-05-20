import type { EventBridgeEvent } from 'aws-lambda';
import { createChildLogger, createLogger, serializeError } from '@api-hub/observability';
import { assignUserRole } from '../services/role.service';
import { userRoleAssignmentRequestedEventSchema } from '../validation/event.validation';
import { UserRepository } from '../repositories/user.repository';
import { PackageRepository } from '../repositories/package.repositrory';
import { RoleRepository } from '../repositories/role.repository';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userRepository = new UserRepository();
const packageRepository = new PackageRepository();
const roleRepository = new RoleRepository();

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
    // Preserve legacy behavior: bootstrap ADMIN role features when role has no features.
    const rolePermissions = await userRepository
      .getRolePermissions(parsed.roleId, parsed.organizationID)
      .catch(() => []);
    if (rolePermissions && rolePermissions.length > 0) {
      const exactRoleMatch =
        rolePermissions.find((item: any) => item.SK === `ROLE#${parsed.roleId}`) ||
        rolePermissions[0];
      const definedRoleCode = exactRoleMatch?.definedRoleCode;
      const hasExistingFeatures =
        Array.isArray((exactRoleMatch as any)?.features) &&
        (exactRoleMatch as any).features.length > 0;

      if (definedRoleCode === 'ADMIN' && !hasExistingFeatures) {
        const orgFeatures = await packageRepository
          .getOrgFeatures(parsed.organizationID, parsed.authHeader)
          .catch(() => []);
        if (orgFeatures && orgFeatures.length > 0) {
          const { roleId, roleName, roleDescription, roleType } = exactRoleMatch as any;
          await roleRepository
            .saveRoles(
              parsed.organizationID,
              roleId,
              roleName,
              roleDescription,
              roleType,
              orgFeatures,
              parsed.authHeader,
            )
            .catch(() => {
              log.error({
                event: 'user_role_assignment_event_failed',
                durationMs: Date.now() - start,
                err: serializeError(new Error('Failed to save role features')),
              });
            });
        }
      }
    }

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
