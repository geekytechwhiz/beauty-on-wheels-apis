import { APPLICATION_ROLE } from '@api-hub/authentication-core';

import {
  grantUserRole,
  type ApplicationRoleRepository,
} from './application-role-assignment';

export interface VendorEmailVerifiedRoleInput {
  userId: string;
  vendorId: string;
  emailVerified: true;
}

/**
 * The event is published only by Vendor Service after it has persisted both
 * completed onboarding and email verification.  This keeps Identity from
 * reading another service's table while retaining one role-grant write path.
 */
export async function applyVendorEmailVerifiedRole(
  input: VendorEmailVerifiedRoleInput,
  repository: ApplicationRoleRepository,
): Promise<'created' | 'exists'> {
  return grantUserRole(repository, input.userId, APPLICATION_ROLE.VENDOR);
}
