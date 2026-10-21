import { BaseRepository } from '@api-hub/utils';

import {
  applicationUserResolution,
  linkedApplicationUserId,
} from './application-user';
import type { AuthUser, AuthUserDirectory } from './auth-context';

const USER_PREFIX = 'USER#';
const IDENTITY_PREFIX = 'IDENTITY#';
const ROLE_PREFIX = 'ROLE#';
const PERMISSION_PREFIX = 'PERMISSION#';
const META_SK = 'META';
const PROFILE_SK = 'PROFILE';
const LOOKUP_SK = 'LOOKUP';

interface IdentityLookupItem {
  userId?: string;
  identityId?: string;
}

interface UserMetaItem {
  userId?: string;
  identityId?: string;
  roleId?: string;
  status?: string;
}

interface ProfileItem {
  userProvisioning?: {
    status?: string;
    userId?: string;
  };
}

interface UserRoleItem {
  roleId?: string;
}

interface RolePermissionItem {
  permissionId?: string;
}

function resolveIdentityTable(): string {
  const table =
    process.env.DYNAMODB_TABLE_NAME?.trim() ||
    process.env.IDENTITY_TABLE?.trim();
  if (!table) {
    throw new Error(
      'DYNAMODB_TABLE_NAME or IDENTITY_TABLE is required to resolve application users',
    );
  }
  return table;
}

/**
 * Resolves Cognito `sub` → application user → roles → permissions from the
 * Identity single-table (PK/SK schema used by identity-v1-service).
 */
export class DynamoDbAuthUserDirectory
  extends BaseRepository
  implements AuthUserDirectory
{
  constructor(private readonly tableName: string = resolveIdentityTable()) {
    super();
  }

  async findUserByIdentityId(identityId: string): Promise<AuthUser | null> {
    const trimmedIdentityId = identityId.trim();
    const lookup = await this.get<IdentityLookupItem>(this.tableName, {
      PK: `${IDENTITY_PREFIX}${trimmedIdentityId}`,
      SK: LOOKUP_SK,
    });
    if (!lookup?.userId?.trim()) {
      return null;
    }

    const identityUserId = lookup.userId.trim();
    const user = await this.get<UserMetaItem>(this.tableName, {
      PK: `${USER_PREFIX}${identityUserId}`,
      SK: META_SK,
    });
    if (!user?.userId?.trim()) {
      return null;
    }

    const profile = await this.get<ProfileItem>(this.tableName, {
      PK: `${USER_PREFIX}${identityUserId}`,
      SK: PROFILE_SK,
    });
    const resolution = applicationUserResolution(
      profile?.userProvisioning,
      trimmedIdentityId,
    );
    // In-progress or failed User Service provisioning is not an application
    // user. A DynamoDB error throws instead of being treated as legacy.
    if (resolution === 'unresolved') {
      return null;
    }

    const applicationUserId = linkedApplicationUserId(
      profile?.userProvisioning,
      trimmedIdentityId,
    );
    return {
      userId: user.userId.trim(),
      ...(applicationUserId ? { applicationUserId } : {}),
      identityId: user.identityId ?? trimmedIdentityId,
      roleId: user.roleId,
      status: user.status,
    };
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const assigned = await this.query<UserRoleItem>({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `${USER_PREFIX}${userId.trim()}`,
        ':skPrefix': ROLE_PREFIX,
      },
    });
    const roleIds = assigned
      .map((item) => item.roleId)
      .filter((roleId): roleId is string => Boolean(roleId?.trim()));
    if (roleIds.length > 0) {
      return roleIds;
    }

    const user = await this.get<UserMetaItem>(this.tableName, {
      PK: `${USER_PREFIX}${userId.trim()}`,
      SK: META_SK,
    });
    return user?.roleId ? [user.roleId] : [];
  }

  async getPermissionsForRoles(roleIds: string[]): Promise<string[]> {
    const unique = new Set<string>();
    for (const roleId of roleIds) {
      const permissions = await this.query<RolePermissionItem>({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `${ROLE_PREFIX}${roleId.trim()}`,
          ':skPrefix': PERMISSION_PREFIX,
        },
      });
      for (const permission of permissions) {
        if (permission.permissionId) {
          unique.add(permission.permissionId);
        }
      }
    }
    return [...unique];
  }
}

let directory: DynamoDbAuthUserDirectory | undefined;

export function getDynamoDbAuthUserDirectory(): DynamoDbAuthUserDirectory {
  if (!directory) {
    directory = new DynamoDbAuthUserDirectory();
  }
  return directory;
}
