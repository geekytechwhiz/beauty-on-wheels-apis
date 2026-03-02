/**
 * API path constants for device service.
 * Single source of truth for default path in logging and error context.
 */
export const PATHS = {
  DEVICES_REGISTER: '/devices/register',
  DEVICES_USER_REGISTER: '/devices/user/register',
  DEVICES_USER_DELETE: '/devices/user/delete',
  DEVICES_GET: '/devices/{deviceId}',
  DEVICES_LIST: '/devices/list',
  DEVICES_SEARCH: '/devices/search',
  DEVICES_RECOMMENDATIONS_REMOVE: '/devices/recommendations/remove',
  DEVICES_ORG_MANAGE: '/devices/org/manage',
  DEVICES_GLOBAL_REGISTER: '/devices/global/register',
  DEVICES_DELETE_MULTIPLE: '/devices/delete-multiple',
  DEVICES_READING_TIMESTAMP_UPDATE: '/devices/reading-timestamp/{userId}/{configDeviceId}/update',
} as const;
