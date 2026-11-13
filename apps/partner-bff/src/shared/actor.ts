import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { PartnerInternalClient, type PartnerActor } from '../clients/partner-internal.client';

const MANAGER_ROLES = new Set([
  'vendor',
  'vendor_manager',
  'vendor_owner',
  'manager',
  'owner',
]);
const MANAGER_PERMISSIONS = new Set(['vendor:read', 'operations:view', 'visits:view']);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Establishes the actor only from the API Gateway authorizer context. Client
 * headers and query parameters are never copied into this object.
 */
export async function resolvePartnerActor(
  request: LambdaRequest,
  client: PartnerInternalClient,
): Promise<PartnerActor> {
  const auth = request.context.authContext;
  if (!auth?.identityId || !auth.userId?.trim()) {
    throw new UnauthorizedError('A verified application identity is required');
  }
  const roles = auth.roles.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const permissions = auth.permissions.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const managerRole = roles.some((role) => MANAGER_ROLES.has(normalize(role)));
  const managerPermission = permissions.some((permission) => MANAGER_PERMISSIONS.has(permission.trim().toLowerCase()));
  if (!managerRole && !managerPermission) {
    throw new ForbiddenError('Partner manager access is required');
  }

  const membership = await client.resolveOperationalAccess(auth.userId.trim());
  if (!membership.active || membership.role !== 'owner' || !membership.vendorId) {
    throw new ForbiddenError('An active vendor manager membership is required');
  }

  return {
    userId: auth.userId.trim(),
    vendorId: membership.vendorId,
    roles,
    permissions,
    correlationId: request.context.correlationId,
  };
}
