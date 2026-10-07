import { resolveApplicationRoles } from '@api-hub/authentication-core';

import {
  IdentityRepository,
  identityRepositoryInstance,
} from '../repositories/identity.repository';

/**
 * Resolves access-token roles from the identity user record and USER#/ROLE# mappings.
 * Cognito `scope` is not an input. Vendor profile and onboarding fields are not read.
 */
export async function loadApplicationRolesForIdentity(
  identityId: string,
  repository: IdentityRepository = identityRepositoryInstance,
): Promise<string[]> {
  const user = await repository.getUserByIdentityId(identityId);
  if (!user) {
    return [];
  }

  const assigned = await repository.getUserRoles(user.userId);
  return resolveApplicationRoles([...(assigned ?? []), user.roleId]);
}
