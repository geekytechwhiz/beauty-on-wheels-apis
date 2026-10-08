import { resolveApplicationRoles } from '@api-hub/authentication-core';
import { createLogger } from '@api-hub/observability';

import {
  IdentityRepository,
  identityRepositoryInstance,
} from '../repositories/identity.repository';

const logger = createLogger({
  service: 'identity-pre-token-generation',
  redactPII: true,
});

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
    // A missing mapping is different from a DynamoDB failure: the latter is
    // deliberately allowed to throw so token issuance cannot mistake it for a
    // legitimate unprivileged user.
    logger.info({
      event: 'pre_token_generation_identity_not_found',
      identityLookup: 'missing',
    });
    return [];
  }

  const assigned = await repository.getUserRoles(user.userId);
  const roles = resolveApplicationRoles([...(assigned ?? []), user.roleId]);
  logger.info({
    event:
      roles.length > 0
        ? 'pre_token_generation_roles_resolved'
        : 'pre_token_generation_no_roles',
    identityLookup: 'resolved',
    roleCount: roles.length,
  });
  return roles;
}
