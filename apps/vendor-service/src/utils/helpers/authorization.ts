import { ForbiddenError, LambdaRequest } from '@api-hub/utils';

import { VENDOR_CAPABILITY, VendorCapability } from '../../domain/vendor-self';
import { VendorDdbItem } from '../../types/repository.types';
import {
  getAuthenticatedUserId,
} from './vendor-request';

const ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
  'superadmin',
  'platform_admin',
  'platformadmin',
  'admin_staff',
]);

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string' && value.trim()) {
    return [value];
  }
  return [];
}

export function getCallerRoles(request: LambdaRequest): string[] {
  return [
    ...asStringArray(request.context.authContext?.roles),
    ...asStringArray(request.context.userContext?.roles),
  ];
}

export function isAdminCaller(request: LambdaRequest): boolean {
  return getCallerRoles(request).some((role) =>
    ADMIN_ROLES.has(role.trim().toLowerCase().replace(/[\s-]+/g, '_')),
  );
}

export function isVendorOwner(
  vendor: Pick<VendorDdbItem, 'ownerUserId'>,
  userId: string,
): boolean {
  return vendor.ownerUserId === userId;
}

export function assertVendorAccess(
  request: LambdaRequest,
  vendor: Pick<VendorDdbItem, 'ownerUserId' | 'vendorId'>,
): string {
  const authenticatedUserId = getAuthenticatedUserId(request);

  if (isVendorOwner(vendor, authenticatedUserId) || isAdminCaller(request)) {
    return authenticatedUserId;
  }

  throw new ForbiddenError('Not authorized to access this vendor');
}

const MANAGER_ONLY = new Set<VendorCapability>([
  VENDOR_CAPABILITY.STAFF_MANAGE,
  VENDOR_CAPABILITY.CREW_MANAGE,
]);

export interface VendorMembershipGrant {
  vendorId: string;
  status: string;
}

/**
 * Owner and admin callers pass. An active staff member may read only when the
 * token carries that view capability. Staff cannot manage staff or crews.
 * The path vendor id is the only vendor considered.
 */
export function assertVendorAction(
  request: LambdaRequest,
  vendor: Pick<VendorDdbItem, 'ownerUserId' | 'vendorId'>,
  action: VendorCapability,
  membership?: VendorMembershipGrant,
): string {
  const authenticatedUserId = getAuthenticatedUserId(request);

  if (isVendorOwner(vendor, authenticatedUserId) || isAdminCaller(request)) {
    return authenticatedUserId;
  }

  const activeHere = Boolean(
    membership
    && membership.vendorId === vendor.vendorId
    && membership.status === 'ACTIVE',
  );
  const granted = new Set([
    ...asStringArray(request.context.authContext?.permissions),
    ...asStringArray(request.context.userContext?.permissions),
  ]);

  if (activeHere && !MANAGER_ONLY.has(action) && granted.has(action)) {
    return authenticatedUserId;
  }

  throw new ForbiddenError('Not authorized to access this vendor');
}

export function assertAdminAccess(request: LambdaRequest): string {
  const authenticatedUserId = getAuthenticatedUserId(request);

  // Keep it commented for now to allow any user to access the API
  // if (!isAdminCaller(request)) {
  //   throw new ForbiddenError('Administrator access is required');
  // }
  return authenticatedUserId;
}
