import {
  ForbiddenError,
  LambdaRequest,
  UnauthorizedError,
  ValidationError,
} from '@api-hub/utils';

import { WorkingHoursItem } from '../types/records';

const ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
  'superadmin',
  'platform_admin',
  'platformadmin',
  'admin_staff',
]);

const VENDOR_ROLES = new Set([
  'vendor',
  'vendor_owner',
  'vendorowner',
  'provider',
  'partner',
  'owner',
  'customer',  // removed from the list of roles in the booking service
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

function normalizeRole(role: string): string {
  return role.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function getCallerRoles(request: LambdaRequest): string[] {
  return [
    ...asStringArray(request.context.authContext?.roles),
    ...asStringArray(request.context.userContext?.roles),
  ].map(normalizeRole);
}

export function isAdminCaller(request: LambdaRequest): boolean {
  return getCallerRoles(request).some((role) => ADMIN_ROLES.has(role));
}

export function hasVendorRole(request: LambdaRequest): boolean {
  return getCallerRoles(request).some((role) => VENDOR_ROLES.has(role));
}

function identityId(request: LambdaRequest): string | undefined {
  const value =
    request.context.authContext?.identityId ??
    request.context.userContext?.identityId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getAuthenticatedUserId(request: LambdaRequest): string {
  const authorizerUserId = request.context.authContext?.userId?.trim();
  if (authorizerUserId) {
    return authorizerUserId;
  }
  const contextUserId = request.context.userContext?.userId?.trim();
  const cognitoSub = identityId(request);
  if (contextUserId && contextUserId !== cognitoSub) {
    return contextUserId;
  }
  if (cognitoSub) {
    throw new UnauthorizedError('Authenticated user id is required');
  }
  throw new UnauthorizedError('Unauthorized');
}

export function assertCanManageSchedule(
  request: LambdaRequest,
  schedule: Pick<WorkingHoursItem, 'ownerUserId'> | null,
): string {
  const userId = getAuthenticatedUserId(request);
  if (isAdminCaller(request)) {
    return userId;
  }
  if (!hasVendorRole(request)) {
    throw new ForbiddenError('Vendor access is required');
  }
  if (schedule && schedule.ownerUserId !== userId) {
    throw new ForbiddenError('Not authorized to access this vendor');
  }
  return userId;
}

export function isScheduleManager(
  request: LambdaRequest,
  schedule: Pick<WorkingHoursItem, 'ownerUserId'> | null,
): boolean {
  if (!schedule) {
    return isAdminCaller(request);
  }
  if (isAdminCaller(request)) {
    return true;
  }
  const userId = request.context.authContext?.userId ?? request.context.userContext?.userId;
  return Boolean(userId) && hasVendorRole(request) && schedule.ownerUserId === userId;
}

export function assertHoldOwnerOrManager(
  request: LambdaRequest,
  hold: { customerId: string },
  schedule: Pick<WorkingHoursItem, 'ownerUserId'> | null,
): void {
  const userId = getAuthenticatedUserId(request);
  if (hold.customerId === userId || isScheduleManager(request, schedule)) {
    return;
  }
  throw new ForbiddenError('Not authorized to access this hold');
}

export function requirePathId(value: string, name: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(trimmed)) {
    throw new ValidationError(`${name} is invalid`);
  }
  return trimmed;
}
