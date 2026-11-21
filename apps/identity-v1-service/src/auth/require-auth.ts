import {
  authenticate,
  authorize,
  type AuthContext,
  type AuthorizeOptions,
} from '@api-hub/authentication-core';
import type { LambdaRequest } from '@api-hub/utils';

import { getIdentityAuthUserDirectory } from './identity-user-directory';

/**
 * Re-resolve the identity-owned user for the self/profile endpoints.  The
 * shared authorizer intentionally omits an application user while provisioning
 * is pending, but these endpoints must remain available to that identity.
 */
export async function requireAuth(request: LambdaRequest): Promise<AuthContext> {
  return authenticate(request, {
    userDirectory: getIdentityAuthUserDirectory(),
    requireApplicationUser: true,
  });
}

export function requireRole(roles: string[] | AuthorizeOptions) {
  const options: AuthorizeOptions = Array.isArray(roles)
    ? { roles }
    : roles;

  return async (request: LambdaRequest): Promise<AuthContext> => {
    await requireAuth(request);
    return authorize(request, options, {
      userDirectory: getIdentityAuthUserDirectory(),
      requireApplicationUser: true,
    });
  };
}

/** @deprecated Use {@link requireRole}. Platform auth is role-only. */
export const requirePermission = requireRole;
