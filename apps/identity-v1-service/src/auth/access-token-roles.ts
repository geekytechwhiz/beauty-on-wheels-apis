import {
  linkedApplicationUserId,
  resolveApplicationRoles,
} from '@api-hub/authentication-core';
import { createLogger } from '@api-hub/observability';

import {
  IdentityRepository,
  identityRepositoryInstance,
} from '../repositories/identity.repository';

export type ApplicationTokenClaims = {
  roles: string[];
  /** Missing only on an identity record that cannot be resolved. */
  identityId?: string;
  /**
   * User Service application user id. Present only after that service has
   * stored the identity lookup and Identity has linked it. Never Cognito `sub`.
   */
  userId?: string;
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
  // User Service persists IDENTITY#{identityId}/LOOKUP via getIdentityLookup.
  // The linked profile is that mapping; Identity does not read the user table.
  const profile = await repository.getProfile(user.userId);
  const userId = linkedApplicationUserId(profile?.userProvisioning, identityId);
  logger.info({
    event: userId
      ? 'pre_token_generation_application_user_resolved'
      : 'pre_token_generation_application_user_missing',
    identityLookup: 'resolved',
    applicationUser: userId ? 'linked' : profile?.userProvisioning?.status ?? 'missing',
  });
  // Missing userType identifies a legacy record, not a CUSTOMER authorization
  // grant. Role mappings above remain authoritative.
  return {
    roles,
    // The lookup key is Cognito's `sub`; use the persisted link rather than
    // trusting any client-side identity value.
    identityId: user.identityId ?? identityId,
    ...(userId ? { userId } : {}),
    userType: user.userType ?? 'CUSTOMER',
  };
}
