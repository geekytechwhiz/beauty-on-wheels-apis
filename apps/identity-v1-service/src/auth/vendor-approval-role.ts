import { APPLICATION_ROLE } from '@api-hub/authentication-core';

import {
  grantVendorApplicationRole,
  type ApplicationRoleRepository,
} from './application-role-assignment';

export interface VendorApprovalRoleInput {
  newStatus?: string;
  ownerUserId?: string;
  onboardingStatus?: string;
}

/**
 * Vendor approval adds the VENDOR application role for the owner.
 * Onboarding statuses such as PENDING, UNDER_REVIEW, APPROVED, and REJECTED
 * are business state and are not roles.
 */
export function vendorRoleGrantFromApproval(
  input: VendorApprovalRoleInput,
): { userId: string; role: typeof APPLICATION_ROLE.VENDOR } | undefined {
  if (input.newStatus !== 'ACTIVE') {
    return undefined;
  }
  const userId = input.ownerUserId?.trim();
  if (!userId) {
    return undefined;
  }
  return { userId, role: APPLICATION_ROLE.VENDOR };
}

export async function applyVendorApprovalRole(
  input: VendorApprovalRoleInput,
  repository: ApplicationRoleRepository,
): Promise<'granted' | 'skipped'> {
  const grant = vendorRoleGrantFromApproval(input);
  if (!grant) {
    return 'skipped';
  }
  await grantVendorApplicationRole(repository, grant.userId);
  return 'granted';
}
