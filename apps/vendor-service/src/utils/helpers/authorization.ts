import {
  ForbiddenError,
  LambdaRequest,
} from '@api-hub/utils';

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

export function assertAdminAccess(request: LambdaRequest): string {
  const authenticatedUserId = getAuthenticatedUserId(request);

  if (!isAdminCaller(request)) {
    throw new ForbiddenError('Administrator access is required');
  }
  return authenticatedUserId;
}
