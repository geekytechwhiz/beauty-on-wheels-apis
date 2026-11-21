import { BaseError, ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { authenticate, getAuthContext } from './authenticate';
import type { AuthContext, AuthenticateOptions, AuthorizeOptions } from './auth-context';
import { resolveApplicationRoles } from './application-roles';

function hasRequiredRoles(
  granted: string[],
  required: string[],
  requireAll: boolean,
): boolean {
  const grantedSet = new Set(resolveApplicationRoles(granted));
  const needed = resolveApplicationRoles(required);
  if (needed.length === 0) {
    return true;
  }
  if (requireAll) {
    return needed.every((role) => grantedSet.has(role));
  }
  return needed.some((role) => grantedSet.has(role));
}

/**
 * Ensures the request is authenticated and the caller has the required role(s).
 *
 * 401 when authentication fails.
 * 403 when the identity is valid but lacks the role (or has no application user).
 *
 * Platform authorization is role-only. Permission identifiers are not checked.
 */
export async function authorize(
  request: LambdaRequest,
  options: AuthorizeOptions,
  authenticateOptions?: AuthenticateOptions,
): Promise<AuthContext> {
  let ctx = getAuthContext(request);
  if (!ctx) {
    ctx = await authenticate(request, authenticateOptions);
  }

  if (!ctx.identityId) {
    throw new UnauthorizedError('Unauthorized');
  }

  if (authenticateOptions?.userDirectory && !ctx.userId) {
    throw new BaseError(
      'Application user mapping not found',
      403,
      'APPLICATION_USER_NOT_FOUND',
    );
  }

  const required = options.roles ?? [];
  if (required.length === 0) {
    return ctx;
  }

  const requireAll = options.requireAll !== false;
  if (!hasRequiredRoles(ctx.roles, required, requireAll)) {
    throw new ForbiddenError('Insufficient role');
  }

  return ctx;
}
