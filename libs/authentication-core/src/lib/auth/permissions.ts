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
} as const;

export type PermissionId = (typeof PERMISSION)[keyof typeof PERMISSION];
