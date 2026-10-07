import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';

import { getOptionalAuthenticatedUserId } from './request';

const ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
  'superadmin',
  'platform_admin',
  'platformadmin',
  'admin_staff',
]);

const SERVICE_ROLES = new Set([
  'service',
  'service_principal',
  'serviceprincipal',
  'whatsapp',
  'notification',
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
  ];
}

export function hasCallerIdentity(request: LambdaRequest): boolean {
  return (
    Boolean(getOptionalAuthenticatedUserId(request)) ||
    getCallerRoles(request).length > 0
  );
}

export function isAdminCaller(request: LambdaRequest): boolean {
  return getCallerRoles(request).some((role) => ADMIN_ROLES.has(normalizeRole(role)));
}

export function isServicePrincipal(request: LambdaRequest): boolean {
  return getCallerRoles(request).some((role) =>
    SERVICE_ROLES.has(normalizeRole(role)),
  );
}

function assertKnownCaller(request: LambdaRequest): void {
  if (!hasCallerIdentity(request)) {
    throw new UnauthorizedError('Unauthorized');
  }
}

export function assertAdminAccess(request: LambdaRequest): string | undefined {
  assertKnownCaller(request);
  if (!isAdminCaller(request)) {
    throw new ForbiddenError('Administrator access is required');
  }
  return getOptionalAuthenticatedUserId(request);
}

export function assertServiceOrAdmin(request: LambdaRequest): void {
  assertKnownCaller(request);
  if (isAdminCaller(request) || isServicePrincipal(request)) {
    return;
  }
  throw new ForbiddenError('Service principal access is required');
}

export function assertOwnerOrAdmin(
  request: LambdaRequest,
  resourceUserId: string,
): string {
  assertKnownCaller(request);
  const userId = getOptionalAuthenticatedUserId(request);

  if (isAdminCaller(request)) {
    if (!userId) {
      throw new UnauthorizedError('Unauthorized');
    }
    return userId;
  }

  if (userId && userId === resourceUserId) {
    return userId;
  }

  throw new ForbiddenError('Not authorized to access this user');
}

export function assertOwnerAdminOrService(
  request: LambdaRequest,
  resourceUserId: string,
): void {
  assertKnownCaller(request);
  if (isAdminCaller(request) || isServicePrincipal(request)) {
    return;
  }
  assertOwnerOrAdmin(request, resourceUserId);
}
