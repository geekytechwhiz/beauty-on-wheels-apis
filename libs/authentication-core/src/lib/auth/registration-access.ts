import { APPLICATION_ROLE, resolveApplicationRoles } from './application-roles';
import { PERMISSION } from './permissions';

const BROADER_ADMIN_ROLES = new Set([
  'admin',
  'super_admin',
  'superadmin',
  'platform_admin',
  'platformadmin',
  'admin_staff',
]);

export interface RegistrationAccessInput {
  roles: readonly string[];
  permissions: readonly string[];
}

function normalizedRoles(roles: readonly string[]): string[] {
  return roles
    .filter((role): role is string => typeof role === 'string')
    .map((role) => role.trim().toLowerCase().replace(/[\s-]+/g, '_'))
    .filter(Boolean);
}

/**
 * REGISTRANT without an operating vendor role, an admin role, or vendor:create.
 * Role names are matched exactly. A userType value is not a role.
 */
export function isRegistrationOnlyAccess(
  input: RegistrationAccessInput,
): boolean {
  const application = resolveApplicationRoles(input.roles);
  const permissions = new Set(
    input.permissions.filter((item): item is string => typeof item === 'string'),
  );
  const broader =
    application.includes(APPLICATION_ROLE.VENDOR) ||
    application.includes(APPLICATION_ROLE.ADMIN) ||
    normalizedRoles(input.roles).some((role) => BROADER_ADMIN_ROLES.has(role)) ||
    permissions.has(PERMISSION.VENDOR_CREATE);
  return application.includes(APPLICATION_ROLE.REGISTRANT) && !broader;
}

export function hasResolvedRegisterPermission(
  permissions: readonly string[],
): boolean {
  return permissions.includes(PERMISSION.VENDOR_REGISTER);
}
