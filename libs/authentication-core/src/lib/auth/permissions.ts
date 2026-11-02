import { APPLICATION_ROLE, resolveApplicationRoles } from './application-roles';

/**
 * Canonical permission identifiers used by authorize().
 * Values are stored on Role → Permission items in the identity table.
 */
export const PERMISSION = {
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',

  VENDOR_READ: 'vendor:read',
  VENDOR_CREATE: 'vendor:create',
  VENDOR_UPDATE: 'vendor:update',
  /**
   * Lets a phone-verified registrant start vendor registration.
   * Issued in code for the REGISTRANT role only. It is not vendor:create,
   * vendor:read, or vendor:update.
   */
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

  /**
   * Catalog mutations. Identity must grant this permission or an admin role
   * before service-catalog write handlers allow the call.
   */
  CATALOG_READ: 'catalog:read',
  CATALOG_WRITE: 'catalog:write',
} as const;

export type PermissionId = (typeof PERMISSION)[keyof typeof PERMISSION];

/**
 * Server-issued permission for REGISTRANT. DynamoDB rows on that role are
 * ignored so a stored vendor:read or vendor:create cannot widen it.
 */
export function issuedRegistrationPermissions(
  roles: readonly string[],
): PermissionId[] {
  return resolveApplicationRoles(roles).includes(APPLICATION_ROLE.REGISTRANT)
    ? [PERMISSION.VENDOR_REGISTER]
    : [];
}
