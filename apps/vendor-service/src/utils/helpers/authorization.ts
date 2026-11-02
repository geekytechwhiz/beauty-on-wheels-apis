import { BaseError, ForbiddenError, LambdaRequest } from '@api-hub/utils';

import type { VendorCapability } from '../../domain/vendor-self';
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

function trustedAccess(request: LambdaRequest): {
  roles: string[];
  permissions: string[];
} {
  const auth = request.context.authContext;
  // authContext is populated from the authorizer and must take precedence over
  // userContext. Some trusted internal invocations carry an application userId
  // without an identityId, so the presence of any resolved access attribute is
  // enough to select it.
  if (
    auth &&
    (auth.identityId || auth.userId || asStringArray(auth.roles).length > 0 || asStringArray(auth.permissions).length > 0)
  ) {
    return {
      roles: asStringArray(auth.roles),
      permissions: asStringArray(auth.permissions),
    };
  }
  return {
    roles: asStringArray(request.context.userContext?.roles),
    permissions: asStringArray(request.context.userContext?.permissions),
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function hasRole(request: LambdaRequest, role: string): boolean {
  return getCallerRoles(request).some((value) => normalize(value) === role);
}

function hasPermission(request: LambdaRequest, permission: string): boolean {
  return getCallerPermissions(request).some((value) => value.trim().toLowerCase() === permission);
}

export function getCallerRoles(request: LambdaRequest): string[] {
  return trustedAccess(request).roles;
}

export function isAdminCaller(request: LambdaRequest): boolean {
  return getCallerRoles(request).some((role) =>
    ADMIN_ROLES.has(normalize(role)),
  );
}

export function isVendorOwner(
  vendor: Pick<VendorDdbItem, 'ownerUserId'>,
  userId: string,
): boolean {
  return vendor.ownerUserId === userId;
}

export function isRegistrationOnlyCaller(request: LambdaRequest): boolean {
  return hasRole(request, 'registrant');
}

/**
 * REGISTRANT may create a draft vendor and nothing else. Ownership does not
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
  throw new ForbiddenError('Not authorized to access this vendor');
}

export interface VendorMembershipGrant {
  vendorId: string;
  status: string;
}

/**
 * Owner and admin callers pass. An active staff member may act only when the
 * token carries that capability. Staff cannot manage staff or crews.
 * Community coverage is allowed for a staff token that carries communities:manage.
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
  if (
    membership?.vendorId === vendor.vendorId &&
    membership.status === 'ACTIVE' &&
    hasPermission(request, action)
  ) {
    return userId;
  }
  throw new ForbiddenError('Not authorized to perform this vendor action');
}

/** Authorizer-resolved permissions of the caller. Client input is never consulted. */
export function getCallerPermissions(request: LambdaRequest): string[] {
  return trustedAccess(request).permissions;
}

/**
 * Vendor creation is an application-role decision. CUSTOMER cannot create a
 * vendor, and a client-supplied userType is not a role or a permission.
 * VENDOR is granted only after vendor email verification or approval.
 * vendor:create is accepted only when the authorizer resolved it from a role.
 * REGISTRANT may create only with the authorizer-resolved vendor:register
 * permission and a phone number Identity marked verified.
 */
export function assertCanCreateVendor(request: LambdaRequest): string {
  const userId = getAuthenticatedUserId(request);
  if (isRegistrationOnlyCaller(request)) {
    if (!hasPermission(request, 'vendor:register')) {
      throw new ForbiddenError('Registrant does not have vendor registration permission');
    }
    if (request.context.authContext?.phoneVerified !== true) {
      throw new ForbiddenError('A verified phone number is required for vendor registration');
    }
    if (!request.context.authContext.phoneNumber?.trim()) {
      throw new BaseError(
        'Verified phone number is unavailable',
        409,
        'VERIFIED_PHONE_UNAVAILABLE',
      );
    }
    return userId;
  }
  if (
    isAdminCaller(request) ||
    hasRole(request, 'vendor') ||
    hasPermission(request, 'vendor:create')
  ) {
    return userId;
  }
  throw new ForbiddenError('Vendor creation permission is required');
}

export function assertAdminAccess(request: LambdaRequest): string {
  const userId = getAuthenticatedUserId(request);
  if (!isAdminCaller(request)) {
    throw new ForbiddenError('Administrator access is required');
  }
  return userId;
}
