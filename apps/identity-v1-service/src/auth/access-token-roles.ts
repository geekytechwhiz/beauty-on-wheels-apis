import { resolveApplicationRoles } from '@api-hub/authentication-core';
import { createLogger } from '@api-hub/observability';

import {
  IdentityRepository,
  identityRepositoryInstance,
} from '../repositories/identity.repository';

export type ApplicationTokenClaims = {
  roles: string[];
  /** Missing only on an identity record that cannot be resolved. */
  identityId?: string;
  userType?: 'CUSTOMER' | 'VENDOR' | 'ADMIN';
};

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

/**
 * The single persisted source for application claims added by the Cognito
 * pre-token trigger. userType is classification data; roles remain the sole
 * authorization source.
 */
export async function loadApplicationTokenClaimsForIdentity(
  identityId: string,
  repository: IdentityRepository = identityRepositoryInstance,
): Promise<ApplicationTokenClaims> {
  const user = await repository.getUserByIdentityId(identityId);
  if (!user) {
    logger.info({ event: 'pre_token_generation_identity_not_found', identityLookup: 'missing' });
    return { roles: [] };
  }

  const assigned = await repository.getUserRoles(user.userId);
  const roles = resolveApplicationRoles([...(assigned ?? []), user.roleId]);
  // Missing userType identifies a legacy record, not a CUSTOMER authorization
  // grant. Role mappings above remain authoritative.
  return {
    roles,
    // The lookup key is Cognito's `sub`; use the persisted link rather than
    // trusting any client-side identity value.
    identityId: user.identityId ?? identityId,
    userType: user.userType ?? 'CUSTOMER',
  };
}
