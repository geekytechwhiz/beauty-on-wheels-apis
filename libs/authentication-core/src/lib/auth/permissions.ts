import { APPLICATION_ROLE, resolveApplicationRoles } from './application-roles';

/**
 * Legacy permission identifiers.
 *
 * Platform authorization is role-only. These constants remain for identity
 * admin APIs and older tests; the authorizer and service asserts do not use them.
 */
export const PERMISSION = {
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',

  VENDOR_READ: 'vendor:read',
  VENDOR_CREATE: 'vendor:create',
  VENDOR_UPDATE: 'vendor:update',
  VENDOR_REGISTER: 'vendor:register',

  VEHICLE_READ: 'vehicle:read',
  VEHICLE_CREATE: 'vehicle:create',
  VEHICLE_UPDATE: 'vehicle:update',
  VEHICLE_DELETE: 'vehicle:delete',

  BOOKING_READ: 'booking:read',
  BOOKING_CREATE: 'booking:create',
  BOOKING_UPDATE: 'booking:update',
  BOOKING_CANCEL: 'booking:cancel',

  PRICING_READ: 'pricing:read',
  PRICING_UPDATE: 'pricing:update',

  CATALOG_READ: 'catalog:read',
  CATALOG_WRITE: 'catalog:write',
} as const;

export type PermissionId = (typeof PERMISSION)[keyof typeof PERMISSION];

/**
 * @deprecated Role-only auth no longer issues registration permissions.
 * Prefer checking REGISTRANT/GUEST via {@link resolveApplicationRoles}.
 */
export function issuedRegistrationPermissions(
  roles: readonly string[],
): PermissionId[] {
  return resolveApplicationRoles(roles).includes(APPLICATION_ROLE.REGISTRANT) ||
    resolveApplicationRoles(roles).includes(APPLICATION_ROLE.GUEST)
    ? [PERMISSION.VENDOR_REGISTER]
    : [];
}
