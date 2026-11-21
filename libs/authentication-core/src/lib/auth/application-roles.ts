/**
 * Application roles carried on the access-token `roles` claim.
 * These are role codes, not Cognito OAuth scopes.
 *
 * Platform authorization is role-only. Fine-grained permission rows are not
 * consulted by the authorizer or service asserts.
 */
export const APPLICATION_ROLE = {
  /** Unauthenticated / registration guest. Alias of REGISTRANT in the catalog. */
  GUEST: 'GUEST',
  CUSTOMER: 'CUSTOMER',
  /**
   * Phone-verified vendor registration only. The code does not contain
   * "vendor", so existing checks that look for that substring cannot treat
   * it as an operating vendor role.
   */
  REGISTRANT: 'REGISTRANT',
  VENDOR: 'VENDOR',
  /** Operational vendor employee. Membership remains vendor-service owned. */
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
  /** Platform root. Highest privilege; includes every admin capability. */
  ROOT: 'ROOT',
} as const;

export type ApplicationRole =
  (typeof APPLICATION_ROLE)[keyof typeof APPLICATION_ROLE];

const APPLICATION_ROLE_ORDER: readonly ApplicationRole[] = [
  APPLICATION_ROLE.GUEST,
  APPLICATION_ROLE.CUSTOMER,
  APPLICATION_ROLE.REGISTRANT,
  APPLICATION_ROLE.VENDOR,
  APPLICATION_ROLE.STAFF,
  APPLICATION_ROLE.ADMIN,
  APPLICATION_ROLE.ROOT,
];

const APPLICATION_ROLE_BY_KEY: Readonly<Record<string, ApplicationRole>> = {
  guest: APPLICATION_ROLE.GUEST,
  customer: APPLICATION_ROLE.CUSTOMER,
  registrant: APPLICATION_ROLE.REGISTRANT,
  vendor: APPLICATION_ROLE.VENDOR,
  staff: APPLICATION_ROLE.STAFF,
  admin: APPLICATION_ROLE.ADMIN,
  root: APPLICATION_ROLE.ROOT,
};

/** Roles that may administer platform resources (catalog, vendor approval, etc.). */
export const PLATFORM_ADMIN_ROLES: ReadonlySet<ApplicationRole> = new Set([
  APPLICATION_ROLE.ROOT,
  APPLICATION_ROLE.ADMIN,
]);

/** Roles that may operate a vendor workspace as a manager/owner. */
export const PLATFORM_VENDOR_MANAGER_ROLES: ReadonlySet<ApplicationRole> = new Set([
  APPLICATION_ROLE.ROOT,
  APPLICATION_ROLE.ADMIN,
  APPLICATION_ROLE.VENDOR,
]);

/**
 * Maps stored role ids onto the access-token role set.
 * The registration default `user` is not an application role and is omitted.
 * GUEST and REGISTRANT are distinct codes; both mean registration/guest access.
 * Input order does not matter; output follows {@link APPLICATION_ROLE_ORDER}.
 */
export function resolveApplicationRoles(
  roleIds: ReadonlyArray<string | undefined | null>,
): ApplicationRole[] {
  const found = new Set<ApplicationRole>();
  for (const roleId of roleIds) {
    if (typeof roleId !== 'string') {
      continue;
    }
    const canonical = APPLICATION_ROLE_BY_KEY[roleId.trim().toLowerCase()];
    if (canonical) {
      found.add(canonical);
    }
  }
  return APPLICATION_ROLE_ORDER.filter((role) => found.has(role));
}

/**
 * Scalar access-token `role` for clients that read one value.
 * ROOT remains the highest; REGISTRANT/GUEST stay distinct from VENDOR.
 */
export function primaryApplicationRole(
  roles: readonly ApplicationRole[],
): ApplicationRole | undefined {
  if (roles.includes(APPLICATION_ROLE.ROOT)) {
    return APPLICATION_ROLE.ROOT;
  }
  if (roles.includes(APPLICATION_ROLE.ADMIN)) {
    return APPLICATION_ROLE.ADMIN;
  }
  if (roles.includes(APPLICATION_ROLE.VENDOR)) {
    return APPLICATION_ROLE.VENDOR;
  }
  if (roles.includes(APPLICATION_ROLE.STAFF)) {
    return APPLICATION_ROLE.STAFF;
  }
  if (roles.includes(APPLICATION_ROLE.REGISTRANT)) {
    return APPLICATION_ROLE.REGISTRANT;
  }
  if (roles.includes(APPLICATION_ROLE.GUEST)) {
    return APPLICATION_ROLE.GUEST;
  }
  if (roles.includes(APPLICATION_ROLE.CUSTOMER)) {
    return APPLICATION_ROLE.CUSTOMER;
  }
  return undefined;
}

export function hasApplicationRole(
  roles: readonly string[],
  required: ApplicationRole | readonly ApplicationRole[],
): boolean {
  const granted = new Set(resolveApplicationRoles(roles));
  const needed = Array.isArray(required) ? required : [required];
  return needed.some((role) => granted.has(role));
}

export function isPlatformAdminRole(roles: readonly string[]): boolean {
  return hasApplicationRole(roles, [...PLATFORM_ADMIN_ROLES]);
}

export function isRegistrationGuestRole(roles: readonly string[]): boolean {
  return hasApplicationRole(roles, [
    APPLICATION_ROLE.REGISTRANT,
    APPLICATION_ROLE.GUEST,
  ]);
}

export type ParsedAccessTokenRoles =
  | { ok: true; roles: ApplicationRole[] | undefined }
  | { ok: false };

/**
 * Reads the access-token `roles` claim.
 * Absent means a legacy token issued before application roles were added.
 * A JSON array string is accepted because some issuers can only write string claims.
 * Objects (for example vendor profile or onboarding status) are rejected.
 */
export function parseAccessTokenRolesClaim(
  claim: unknown,
): ParsedAccessTokenRoles {
  if (claim === undefined || claim === null) {
    return { ok: true, roles: undefined };
  }

  let values: unknown[];
  if (typeof claim === 'string') {
    const trimmed = claim.trim();
    if (!trimmed) {
      return { ok: true, roles: [] };
    }
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return { ok: false };
        }
        values = parsed;
      } catch {
        return { ok: false };
      }
    } else {
      values = [trimmed];
    }
  } else if (Array.isArray(claim)) {
    values = claim;
  } else {
    return { ok: false };
  }

  if (values.some((value) => typeof value !== 'string')) {
    return { ok: false };
  }

  return {
    ok: true,
    roles: resolveApplicationRoles(values as string[]),
  };
}

/**
 * Roles an API may act on for this request.
 *
 * A verified access token can only keep application roles that Identity still
 * stores. Revocation therefore applies on the next request, before `exp`.
 * A newly granted role is omitted until the next access token is issued.
 * A missing claim receives no application roles. This keeps authorization
 * fail-closed if pre-token role resolution fails while token issuance remains
 * available; clients must obtain a freshly issued token after the trigger is
 * deployed.
 */
export function effectiveAccessTokenRoles(input: {
  tokenRoles: readonly string[] | undefined;
  directoryRoleIds: readonly string[];
  profileRoleId?: string | null;
}): string[] {
  if (input.tokenRoles === undefined) {
    return [];
  }

  const fromToken = resolveApplicationRoles(input.tokenRoles);
  if (fromToken.length > 0) {
    const current = new Set(resolveApplicationRoles(input.directoryRoleIds));
    return fromToken.filter((role) => current.has(role));
  }

  return [];
}
