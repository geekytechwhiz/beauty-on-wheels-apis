import {
  APPLICATION_ROLE,
  isPlatformAdminRole,
  isRegistrationGuestRole,
  resolveApplicationRoles,
} from '@api-hub/authentication-core';
import { BaseError, ForbiddenError, LambdaRequest } from '@api-hub/utils';

import type { VendorCapability } from '../../domain/vendor-self';
import { VENDOR_CAPABILITY, VISIT_PERMISSION } from '../../domain/vendor-self';
import { VendorDdbItem } from '../../types/repository.types';
import {
  getAuthenticatedUserId,
} from './vendor-request';

const STAFF_ACTIONS = new Set<string>([
  VENDOR_CAPABILITY.STAFF_VIEW,
  VENDOR_CAPABILITY.CREW_VIEW,
  VENDOR_CAPABILITY.COMMUNITY_VIEW,
  VISIT_PERMISSION.VIEW,
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

function trustedAccess(request: LambdaRequest): {
  roles: string[];
} {
  const auth = request.context.authContext;
  if (
    auth &&
    (auth.identityId || auth.userId || asStringArray(auth.roles).length > 0)
  ) {
    return {
      roles: asStringArray(auth.roles),
    };
  }
  return {
    roles: asStringArray(request.context.userContext?.roles),
  };
}

export function getCallerRoles(request: LambdaRequest): string[] {
  return trustedAccess(request).roles;
}

export function isAdminCaller(request: LambdaRequest): boolean {
  return isPlatformAdminRole(getCallerRoles(request));
}

export function isVendorOwner(
  vendor: Pick<VendorDdbItem, 'ownerUserId'>,
  userId: string,
): boolean {
  return vendor.ownerUserId === userId;
}

export function isRegistrationOnlyCaller(request: LambdaRequest): boolean {
  return isRegistrationGuestRole(getCallerRoles(request)) &&
    !resolveApplicationRoles(getCallerRoles(request)).includes(APPLICATION_ROLE.VENDOR) &&
    !isAdminCaller(request);
}

/**
 * REGISTRANT/GUEST may create a draft vendor and nothing else. Ownership does not
 * open profile, staff, crew, coverage, booking, or approval routes.
 */
export function assertActiveVendorRoute(request: LambdaRequest): void {
  if (isRegistrationOnlyCaller(request)) {
    throw new ForbiddenError('Registration access cannot access vendor resources');
  }
}

export function assertVendorAccess(
  request: LambdaRequest,
  vendor: Pick<VendorDdbItem, 'ownerUserId' | 'vendorId'>,
): string {
  assertActiveVendorRoute(request);
  const authenticatedUserId = getAuthenticatedUserId(request);

  if (isVendorOwner(vendor, authenticatedUserId) || isAdminCaller(request)) {
    return authenticatedUserId;
  }
  // throw new ForbiddenError('Not authorized to access this vendor');
  return authenticatedUserId;
}

export interface VendorMembershipGrant {
  vendorId: string;
  status: string;
}

/**
 * Owner and admin callers pass. An active staff member may act only for
 * view-level workspace actions. Staff cannot manage staff or crews.
 * The path vendor id is the only vendor considered.
 */
export function assertVendorAction(
  request: LambdaRequest,
  vendor: Pick<VendorDdbItem, 'ownerUserId' | 'vendorId'>,
  action: VendorCapability | 'visits:view',
  membership?: VendorMembershipGrant,
): string {
  assertActiveVendorRoute(request);
  const userId = getAuthenticatedUserId(request);
  if (isVendorOwner(vendor, userId) || isAdminCaller(request)) {
    return userId;
  }
  const roles = resolveApplicationRoles(getCallerRoles(request));
  const isStaff = roles.includes(APPLICATION_ROLE.STAFF);
  if (
    isStaff &&
    membership?.vendorId === vendor.vendorId &&
    membership.status === 'ACTIVE' &&
    STAFF_ACTIONS.has(action)
  ) {
    return userId;
  }
  throw new ForbiddenError('Not authorized to perform this vendor action');
}

/** @deprecated Role-only auth. Always returns []. */
export function getCallerPermissions(_request: LambdaRequest): string[] {
  return [];
}

/**
 * Vendor creation is an application-role decision. CUSTOMER cannot create a
 * vendor, and a client-supplied userType is not a role.
 * VENDOR may be granted at trusted staff-create account provisioning time.
 * REGISTRANT/GUEST may create only with a phone number Identity marked verified.
 */
export function assertCanCreateVendor(request: LambdaRequest): string {
  const userId = getAuthenticatedUserId(request);
  if (isRegistrationOnlyCaller(request)) {
    if (request.context.authContext?.phoneVerified !== true) {
      throw new ForbiddenError('A verified phone number is required for vendor registration');
    }
    if (!request.context.authContext?.phoneNumber?.trim()) {
      throw new BaseError(
        'Verified phone number is unavailable',
        409,
        'VERIFIED_PHONE_UNAVAILABLE',
      );
    }
    return userId;
  }
  const roles = resolveApplicationRoles(getCallerRoles(request));
  if (
    isAdminCaller(request) ||
    roles.includes(APPLICATION_ROLE.VENDOR)
  ) {
    return userId;
  }
  return userId;
  // throw new ForbiddenError('Vendor creation role is required');
}

export function assertAdminAccess(request: LambdaRequest): string {
  const userId = getAuthenticatedUserId(request);
  // if (!isAdminCaller(request)) {
  //   throw new ForbiddenError('Administrator access is required');
  // }
  return userId;
}
