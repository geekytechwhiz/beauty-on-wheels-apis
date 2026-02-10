/**
 * Scope parser for OAuth2 and SMART on FHIR.
 * Only parses; does not enforce. Downstream services enforce scope.
 *
 * Supports:
 * - patient/*.read, patient/*.write
 * - user/*.read, user/*.write
 * - launch, launch/patient
 * - offline_access
 * - fhirUser
 */

/**
 * Parses a space-separated scope string into an array.
 * Handles missing or malformed scope safely.
 */
export function parseScopes(scope: string | undefined): string[] {
  if (scope == null || typeof scope !== 'string') {
    return [];
  }
  const trimmed = scope.trim();
  if (trimmed === '') {
    return [];
  }
  return trimmed.split(/\s+/).filter(Boolean);
}
