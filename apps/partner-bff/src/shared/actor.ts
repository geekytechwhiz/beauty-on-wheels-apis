import {
  APPLICATION_ROLE,
  PLATFORM_ADMIN_ROLES,
  hasApplicationRole,
  PLATFORM_VENDOR_MANAGER_ROLES,
  resolveApplicationRoles,
} from '@api-hub/authentication-core';
import {
  ForbiddenError,
  LambdaRequest,
  UnauthorizedError,
} from '@api-hub/utils';

import {
  PartnerInternalClient,
  type PartnerActor,
} from '../clients/partner-internal.client';

/**
 * Establishes the actor only from the API Gateway authorizer context. Client
 * headers and query parameters are never copied into this object.
 *
 * Partner manager / vendor-home access needs an eligible platform role and
 * canonical Vendor membership (unless the caller is a platform admin). The
 * route vendor id is a target selector only; it can never broaden the actor's
 * Vendor scope.
 *
 * Membership is resolved over Vendor's internal HTTP route using the platform
 * internal bearer — never by forwarding the caller's Cognito JWT.
 */
export async function resolvePartnerActor(
  request: LambdaRequest,
  client: PartnerInternalClient,
): Promise<PartnerActor> {
  const auth = request.context.authContext;
  const vendorId = request.pathParameters?.vendorId?.trim();
  if (!auth?.identityId || !auth.userId?.trim() || !vendorId) {
    throw new UnauthorizedError('A verified application identity is required');
  }
  const roles = auth.roles.filter(
    (value): value is string =>
      typeof value === 'string' && Boolean(value.trim()),
  );
  const permissions = Array.isArray(auth.permissions)
    ? auth.permissions.filter(
        (value): value is string =>
          typeof value === 'string' && Boolean(value.trim()),
      )
    : [];
  const applicationRoles = resolveApplicationRoles(roles);
  const isPlatformAdmin = applicationRoles.some((role) =>
    PLATFORM_ADMIN_ROLES.has(role),
  );
  const hasManagerRole = hasApplicationRole(roles, [
    ...PLATFORM_VENDOR_MANAGER_ROLES,
  ]);
  const hasStaffWorkspaceRole = applicationRoles.some(
    (role) =>
      role === APPLICATION_ROLE.BUDDY ||
      role === APPLICATION_ROLE.STAFF ||
      role === APPLICATION_ROLE.VENDOR,
  );
  if (!isPlatformAdmin && !hasManagerRole && !hasStaffWorkspaceRole) {
    throw new ForbiddenError('Partner manager access is required');
  }

  

  return {
    userId: auth.userId.trim(),
    vendorId,
    roles,
    permissions,
    correlationId: request.context.correlationId,
  };
}

export function isPartnerVendorRole(roles: readonly string[]): boolean {
  return hasApplicationRole(roles, APPLICATION_ROLE.VENDOR);
}

export function isPlatformAdminActor(roles: readonly string[]): boolean {
  return resolveApplicationRoles(roles).some((role) =>
    PLATFORM_ADMIN_ROLES.has(role),
  );
}
