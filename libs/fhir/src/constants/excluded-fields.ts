/**
 * Platform/session/business fields that must never be mapped directly into FHIR resources.
 * Strict mapping only copies declarative mapping targets; this list is defense-in-depth.
 */
export const EXCLUDED_PLATFORM_FIELDS = [
  'isLoggedIn',
  'logoutRequired',
  'tokenUpdatedAt',
  'createdAt',
  'status',
  'roleName',
  'roleID',
] as const;

export type ExcludedPlatformField = (typeof EXCLUDED_PLATFORM_FIELDS)[number];

export function isExcludedPlatformField(fieldName: string): boolean {
  return (EXCLUDED_PLATFORM_FIELDS as readonly string[]).includes(fieldName);
}
