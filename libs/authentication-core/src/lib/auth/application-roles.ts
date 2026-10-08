/**
 * Application roles carried on the access-token `roles` claim.
 * These are role codes, not Cognito OAuth scopes.
 */
export const APPLICATION_ROLE = {
  CUSTOMER: 'CUSTOMER',
  VENDOR: 'VENDOR',
  ADMIN: 'ADMIN',
} as const;

export type ApplicationRole =
  (typeof APPLICATION_ROLE)[keyof typeof APPLICATION_ROLE];

const APPLICATION_ROLE_ORDER: readonly ApplicationRole[] = [
  APPLICATION_ROLE.CUSTOMER,
  APPLICATION_ROLE.VENDOR,
  APPLICATION_ROLE.ADMIN,
];

const APPLICATION_ROLE_BY_KEY: Readonly<Record<string, ApplicationRole>> = {
  customer: APPLICATION_ROLE.CUSTOMER,
  vendor: APPLICATION_ROLE.VENDOR,
  admin: APPLICATION_ROLE.ADMIN,
};

/**
 * Maps stored role ids onto the access-token role set.
 * The registration default `user` is not an application role and is omitted.
 * Input order does not matter; output is CUSTOMER, VENDOR, ADMIN.
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
