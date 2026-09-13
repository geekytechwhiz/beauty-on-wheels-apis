import { BaseError, ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { authenticate, getAuthContext } from './authenticate';
import type { AuthContext, AuthenticateOptions, AuthorizeOptions } from './auth-context';

function hasRequiredPermissions(
  granted: string[],
  required: string[],
  requireAll: boolean,
): boolean {
  const grantedSet = new Set(granted);
  if (requireAll) {
    return required.every((permission) => grantedSet.has(permission));
  }
  return required.some((permission) => grantedSet.has(permission));
}

/**
 * Ensures the request is authenticated and the caller has the required permission(s).
 *
 * 401 when authentication fails.
 * 403 when the identity is valid but lacks the permission (or has no application user).
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

  const required = options.permissions ?? [];
  if (required.length === 0) {
    return ctx;
  }

  const requireAll = options.requireAll !== false;
  if (!hasRequiredPermissions(ctx.permissions, required, requireAll)) {
    throw new ForbiddenError('Insufficient permissions');
  }

  return ctx;
}
