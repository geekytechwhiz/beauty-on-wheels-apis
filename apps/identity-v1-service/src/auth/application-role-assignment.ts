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
  deleteUserRoleMapping(
    userId: string,
    roleId: string,
  ): Promise<'deleted' | 'missing'>;
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
 * Initializes the first application role for a just-created identity. This is
 * deliberately separate from legacy backfill: a persisted userType must never
 * be used to promote or replace roles on an existing identity.
 */
export async function initializeApplicationRoleForNewIdentity(
  repository: ApplicationRoleRepository,
  user: { userId: string; userType?: 'CUSTOMER' | 'VENDOR' | 'ADMIN' },
): Promise<'created' | 'exists'> {
  // ADMIN is not a public registration value. Retaining this branch makes the
  // trusted provisioning path explicit without exposing it through OTP.
  const role = user.userType === 'VENDOR'
    ? APPLICATION_ROLE.VENDOR
    : user.userType === 'ADMIN'
      ? APPLICATION_ROLE.ADMIN
      : APPLICATION_ROLE.CUSTOMER;
  return repository.ensureUserRoleMapping(user.userId, role);
}

/**
 * Adds VENDOR for an approved vendor owner. CUSTOMER is not removed.
 * Onboarding status is not a role and is ignored.
 */
export async function grantVendorApplicationRole(
  repository: ApplicationRoleRepository,
  userId: string,
): Promise<'created' | 'exists'> {
  return grantUserRole(repository, userId, APPLICATION_ROLE.VENDOR);
}

/**
 * The single persistence path for role grants.  Callers are responsible for
 * their own authorization and authoritative business-state checks; this
 * function keeps grants idempotent and never replaces existing mappings.
 */
export async function grantUserRole(
  repository: ApplicationRoleRepository,
  userId: string,
  role: ApplicationRole,
): Promise<'created' | 'exists'> {
  return repository.ensureUserRoleMapping(userId, role);
}

/**
 * Removes VENDOR only. CUSTOMER and ADMIN mappings are left in place.
 * Onboarding status is not a role and is ignored.
 */
export async function revokeVendorApplicationRole(
  repository: ApplicationRoleRepository,
  userId: string,
): Promise<'deleted' | 'missing'> {
  return repository.deleteUserRoleMapping(userId, APPLICATION_ROLE.VENDOR);
}

export type AdminRoleChangeDecision =
  | { ok: true; role: typeof APPLICATION_ROLE.ADMIN }
  | { ok: false; reason: 'forbidden' | 'unsupported_role' };

/**
 * ADMIN is assigned or removed only when the caller already has ADMIN on the
 * verified access token. The requested value must be the ADMIN role code.
 * CUSTOMER and VENDOR are not accepted here.
 */
export function decideAdminRoleChange(input: {
  callerRoles: readonly string[] | undefined;
  requestedRole: string;
}): AdminRoleChangeDecision {
  const caller = resolveApplicationRoles(input.callerRoles ?? []);
  if (!caller.includes(APPLICATION_ROLE.ADMIN)) {
    return { ok: false, reason: 'forbidden' };
  }
  const [requested] = resolveApplicationRoles([input.requestedRole]);
  if (requested !== APPLICATION_ROLE.ADMIN) {
    return { ok: false, reason: 'unsupported_role' };
  }
  return { ok: true, role: APPLICATION_ROLE.ADMIN };
}

export async function grantAdminApplicationRole(
  repository: ApplicationRoleRepository,
  userId: string,
): Promise<'created' | 'exists'> {
  return grantUserRole(repository, userId, APPLICATION_ROLE.ADMIN);
}

export async function revokeAdminApplicationRole(
  repository: ApplicationRoleRepository,
  userId: string,
): Promise<'deleted' | 'missing'> {
  return repository.deleteUserRoleMapping(userId, APPLICATION_ROLE.ADMIN);
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
