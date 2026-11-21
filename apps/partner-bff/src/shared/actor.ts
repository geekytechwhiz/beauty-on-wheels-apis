import {
  APPLICATION_ROLE,
  hasApplicationRole,
  PLATFORM_VENDOR_MANAGER_ROLES,
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
 * Partner manager access needs both an eligible platform role and canonical
 * Vendor membership. The route vendor id is a target selector only; it can
 * never broaden the actor's Vendor scope.
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
  if (!hasApplicationRole(roles, [...PLATFORM_VENDOR_MANAGER_ROLES])) {
    throw new ForbiddenError('Partner manager access is required');
  }

  const membership = await client.resolveOperationalAccess(auth.userId.trim());
  if (
    !membership.active ||
    membership.role !== 'owner' ||
    !membership.vendorId
  ) {
    throw new ForbiddenError('An active vendor manager membership is required');
  }
  if (vendorId !== membership.vendorId) {
    throw new ForbiddenError(
      'The requested vendor is outside the manager membership',
    );
  }

  return {
    userId: auth.userId.trim(),
    vendorId: membership.vendorId,
    roles,
    // Wire compat for downstream delegated calls; never used for asserts.
    permissions: [],
    correlationId: request.context.correlationId,
  };
}

export function isPartnerVendorRole(roles: readonly string[]): boolean {
  return hasApplicationRole(roles, APPLICATION_ROLE.VENDOR);
}
