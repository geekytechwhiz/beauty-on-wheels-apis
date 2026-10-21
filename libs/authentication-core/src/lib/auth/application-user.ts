export type ApplicationUserProvisioning = {
  status?: string;
  userId?: string;
};

/**
 * User Service `getIdentityLookup` is the application user id. Identity stores
 * that id on the profile only after the User.Provisioned link (`LINKED`).
 * Cognito `sub` is never an application user id.
 */
export function linkedApplicationUserId(
  provisioning: ApplicationUserProvisioning | undefined,
  identityId: string,
): string | undefined {
  if (provisioning?.status !== 'LINKED') {
    return undefined;
  }
  const userId = provisioning.userId?.trim();
  if (!userId || userId === identityId.trim()) {
    return undefined;
  }
  return userId;
}

/**
 * `legacy` keeps the pre-provisioning identity subject.
 * `unresolved` is an in-progress, failed, or unusable link and must not
 * authorize an endpoint that requires an application user.
 */
export function applicationUserResolution(
  provisioning: ApplicationUserProvisioning | undefined,
  identityId: string,
): 'legacy' | 'unresolved' | 'linked' {
  if (!provisioning?.status) {
    return 'legacy';
  }
  return linkedApplicationUserId(provisioning, identityId) ? 'linked' : 'unresolved';
}
