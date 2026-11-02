import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

const ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
  'superadmin',
  'platform_admin',
  'platformadmin',
  'admin_staff',
]);

function rolesOf(request: LambdaRequest): string[] {
  const authRoles = request.context.authContext?.roles;
  const userRoles = request.context.userContext?.roles;
  return [...(Array.isArray(authRoles) ? authRoles : []), ...(Array.isArray(userRoles) ? userRoles : [])]
    .filter((role): role is string => typeof role === 'string')
    .map((role) => role.trim().toLowerCase().replace(/[\s-]+/g, '_'));
}

export function callerUserId(request: LambdaRequest): string | undefined {
  const authUser = request.context.authContext?.userId?.trim();
  if (authUser) return authUser;
  const contextUser = request.context.userContext?.userId?.trim();
  return contextUser || undefined;
}

export function isAdminRequest(request: LambdaRequest): boolean {
  return rolesOf(request).some((role) => ADMIN_ROLES.has(role));
}

/** Platform admin only. Returns the admin's application user id. */
export function assertAdmin(request: LambdaRequest): string {
  const userId = callerUserId(request);
  if (!userId) throw new UnauthorizedError('Unauthorized');
  if (!isAdminRequest(request)) throw new ForbiddenError('Administrator access is required');
  return userId;
}
