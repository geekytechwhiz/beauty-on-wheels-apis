import type { AuthUser, AuthUserDirectory } from '@api-hub/authentication-core';

import {
  IdentityRepository,
  identityRepositoryInstance,
} from '../repositories/identity.repository';

export class IdentityAuthUserDirectory implements AuthUserDirectory {
  constructor(
    private readonly repository: IdentityRepository = identityRepositoryInstance,
  ) {}

  async findUserByIdentityId(identityId: string): Promise<AuthUser | null> {
    const user = await this.repository.getUserByIdentityId(identityId);
    if (!user) {
      return null;
    }
    return {
      userId: user.userId,
      identityId: user.identityId,
      roleId: user.roleId,
      status: user.status,
    };
  }

  async getUserRoles(userId: string): Promise<string[]> {
    const assigned = await this.repository.getUserRoles(userId);
    if (assigned.length > 0) {
      return assigned;
    }
    const user = await this.repository.getUser(userId);
    return user?.roleId ? [user.roleId] : [];
  }

  async getPermissionsForRoles(roleIds: string[]): Promise<string[]> {
    const unique = new Set<string>();
    for (const roleId of roleIds) {
      const permissions = await this.repository.listPermissions(roleId);
      for (const permission of permissions) {
        unique.add(permission.permissionId);
      }
    }
    return [...unique];
  }
}

let directory: IdentityAuthUserDirectory;

export function getIdentityAuthUserDirectory(): IdentityAuthUserDirectory {
  if (!directory) {
    directory = new IdentityAuthUserDirectory();
  }
  return directory;
}
