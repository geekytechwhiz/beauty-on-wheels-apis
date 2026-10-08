import { ForbiddenError, LambdaRequest, UnauthorizedError } from '@api-hub/utils';
import { PERMISSION } from '@api-hub/authentication-core';

/**
 * Catalog writes are restricted to catalog administrators.
 *
 * Identity and authorization stay in identity-v1-service and authorizer-service.
 * This helper only reads the authorizer context those services already attach
 * (roles and permissions). It does not look up users or invent a role model.
 *
 * Allowed when the caller has permission `catalog:write`, or an admin role
 * (`ADMIN`, `catalog_admin`, and the existing platform admin role names).
 * Any other authenticated caller is rejected with 403.
 *
 * Dependency: the authorizer must copy `roles` and `permissions` into the
 * request context. Until identity grants `catalog:write` or an admin role,
 * catalog mutations return 403.
 */
const CATALOG_ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
  'superadmin',
  'platform_admin',
  'platformadmin',
  'admin_staff',
  'catalog_admin',
  'catalogadmin',
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

function callerRoles(request: LambdaRequest): string[] {
  return [
    ...asStringArray(request.context.authContext?.roles),
    ...asStringArray(request.context.userContext?.roles),
  ];
}

function callerPermissions(request: LambdaRequest): string[] {
  return [
    ...asStringArray(request.context.authContext?.permissions),
    ...asStringArray(request.context.userContext?.permissions),
  ];
}

function hasCallerIdentity(request: LambdaRequest): boolean {
  return Boolean(
    request.context.authContext?.identityId ||
      request.context.userContext?.identityId ||
      request.context.userContext?.userId,
  );
}

export function isCatalogAdmin(request: LambdaRequest): boolean {
  if (
    callerPermissions(request).includes(PERMISSION.CATALOG_WRITE)
  ) {
    return true;
  }
  return callerRoles(request).some((role) =>
    CATALOG_ADMIN_ROLES.has(normalizeRole(role)),
  );
}

export function assertCatalogAdmin(request: LambdaRequest): void {
  if (!hasCallerIdentity(request)) {
    throw new UnauthorizedError('Unauthorized');
  }
  if (!isCatalogAdmin(request)) {
    throw new ForbiddenError('Catalog administrator access is required');
  }
}
