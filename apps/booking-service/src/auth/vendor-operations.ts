import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import {
  OperationalAccess,
  OperationalAccessGateway,
} from '../integrations/vendor.client';

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

function userIdOf(request: LambdaRequest): string | undefined {
  const authUser = request.context.authContext?.userId?.trim();
  if (authUser) return authUser;
  const contextUser = request.context.userContext?.userId?.trim();
  return contextUser || undefined;
}

/**
 * Owner membership may list the vendor named by that membership.
 * A path vendor id that does not match the membership is denied.
 * Staff are denied. Platform admins may read the path vendor.
 */
export async function assertVendorOperationsAccess(
  request: LambdaRequest,
  pathVendorId: string,
  vendors: OperationalAccessGateway,
): Promise<{ userId: string; vendorId: string }> {
  const vendorId = pathVendorId.trim();
  if (!vendorId) {
    throw new ForbiddenError('Not authorized to access this vendor');
  }
  const userId = userIdOf(request);
  if (!userId) throw new UnauthorizedError('Unauthorized');
  if (rolesOf(request).some((role) => ADMIN_ROLES.has(role))) {
    return { userId, vendorId };
  }

  const access = await vendors.getOperationalAccess(userId);
  assertOwnerMembership(access, vendorId);
  return { userId, vendorId: access.vendorId! };
}

function assertOwnerMembership(access: OperationalAccess, vendorId: string): void {
  if (!access.active || access.role !== 'owner' || access.vendorId !== vendorId) {
    throw new ForbiddenError('Not authorized to access this vendor');
  }
}
