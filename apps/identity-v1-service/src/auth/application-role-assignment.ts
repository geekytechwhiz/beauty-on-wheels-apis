import {
  APPLICATION_ROLE,
  resolveApplicationRoles,
  type ApplicationRole,
} from '@api-hub/authentication-core';

const PRIVILEGED_ROLES = new Set<ApplicationRole>([
  APPLICATION_ROLE.VENDOR,
  APPLICATION_ROLE.ADMIN,
]);

export interface ApplicationRoleRepository {
  getUserRoles(userId: string): Promise<string[]>;
  ensureUserRoleMapping(
    userId: string,
    roleId: string,
  ): Promise<'created' | 'exists'>;
  listUserMetaPage?(exclusiveStartKey?: Record<string, unknown>): Promise<{
    users: Array<{ userId: string; roleId?: string | null }>;
    lastEvaluatedKey?: Record<string, unknown>;
  }>;
}

export interface RoleBackfillPlan {
  /** True when the user has no CUSTOMER, VENDOR, or ADMIN role yet. */
  assignCustomer: boolean;
  /**
   * Privileged roles already stored on the profile but missing a USER#/ROLE# item.
   * Persisting these does not replace them with CUSTOMER.
   */
  preserve: ApplicationRole[];
}

/**
 * Decides the default CUSTOMER mapping for users created before application roles
 * were stored. VENDOR and ADMIN are left in place. An existing CUSTOMER mapping
 * is not written again.
 */
export function planApplicationRoleBackfill(input: {
  mappedRoleIds: ReadonlyArray<string | undefined | null>;
  profileRoleId?: string | null;
}): RoleBackfillPlan {
  const mapped = resolveApplicationRoles(input.mappedRoleIds);
  const profile = resolveApplicationRoles([input.profileRoleId]);
  const explicit = resolveApplicationRoles([
    ...input.mappedRoleIds,
    input.profileRoleId,
  ]);
  const privileged = explicit.some((role) => PRIVILEGED_ROLES.has(role));

  return {
    assignCustomer:
      !privileged && !mapped.includes(APPLICATION_ROLE.CUSTOMER),
    preserve: profile.filter(
      (role) => PRIVILEGED_ROLES.has(role) && !mapped.includes(role),
    ),
  };
}

export async function prepareApplicationRolesForToken(
  repository: ApplicationRoleRepository,
  user: { userId: string; roleId?: string | null },
): Promise<RoleBackfillPlan> {
  const mappedRoleIds = await repository.getUserRoles(user.userId);
  const plan = planApplicationRoleBackfill({
    mappedRoleIds,
    profileRoleId: user.roleId,
  });

  if (plan.assignCustomer) {
    await repository.ensureUserRoleMapping(
      user.userId,
      APPLICATION_ROLE.CUSTOMER,
    );
  }
  for (const role of plan.preserve) {
    await repository.ensureUserRoleMapping(user.userId, role);
  }
  return plan;
}

/**
 * Adds VENDOR for an approved vendor owner. CUSTOMER is not removed.
 * Onboarding status is not a role and is ignored.
 */
export async function grantVendorApplicationRole(
  repository: ApplicationRoleRepository,
  userId: string,
): Promise<'created' | 'exists'> {
  return repository.ensureUserRoleMapping(userId, APPLICATION_ROLE.VENDOR);
}

export interface RoleBackfillSummary {
  scanned: number;
  assignedCustomer: number;
  preserved: number;
  unchanged: number;
}

export async function backfillApplicationRoles(
  repository: ApplicationRoleRepository & {
    listUserMetaPage: NonNullable<ApplicationRoleRepository['listUserMetaPage']>;
  },
): Promise<RoleBackfillSummary> {
  const summary: RoleBackfillSummary = {
    scanned: 0,
    assignedCustomer: 0,
    preserved: 0,
    unchanged: 0,
  };

  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const page = await repository.listUserMetaPage(lastEvaluatedKey);
    for (const user of page.users) {
      summary.scanned += 1;
      const mappedRoleIds = await repository.getUserRoles(user.userId);
      const plan = planApplicationRoleBackfill({
        mappedRoleIds,
        profileRoleId: user.roleId,
      });

      let changed = false;
      if (plan.assignCustomer) {
        const result = await repository.ensureUserRoleMapping(
          user.userId,
          APPLICATION_ROLE.CUSTOMER,
        );
        if (result === 'created') {
          summary.assignedCustomer += 1;
          changed = true;
        }
      }
      for (const role of plan.preserve) {
        const result = await repository.ensureUserRoleMapping(user.userId, role);
        if (result === 'created') {
          summary.preserved += 1;
          changed = true;
        }
      }
      if (!changed) {
        summary.unchanged += 1;
      }
    }
    lastEvaluatedKey = page.lastEvaluatedKey;
  } while (lastEvaluatedKey);

  return summary;
}
