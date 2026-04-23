/**
 * Scope-to-Resource Mapping — maps OAuth2/SMART scopes to allowed FHIR resources and actions.
 * Used by FHIR gateway to enforce scope before serving a request.
 */

import type { FhirAction } from './types';

/** SMART scope patterns: context/resourceType.action or wildcards (e.g. patient/*.read). */
const SCOPE_PATTERNS = [
  /^patient\/([^.]+)\.(read|write|search|\*)$/i,
  /^user\/([^.]+)\.(read|write|search|\*)$/i,
  /^launch(\/patient)?$/i,
  /^fhirUser$/i,
  /^offline_access$/i,
];

/**
 * Parses a single scope string into zero or more (resourceType, action) pairs.
 * - patient/Patient.read → [['Patient', 'read']]
 * - patient/*.read → all resource types with 'read' (represented as ['*', 'read'])
 * - launch, fhirUser, offline_access → no direct resource mapping (caller may allow launch context).
 */
function scopeToResourceAction(scope: string): Array<[string, FhirAction]> {
  const trimmed = scope.trim();
  if (!trimmed) return [];

  if (trimmed === 'launch' || trimmed === 'launch/patient' || trimmed === 'fhirUser' || trimmed === 'offline_access') {
    return [];
  }

  for (const re of SCOPE_PATTERNS) {
    const m = trimmed.match(re);
    if (!m) continue;
    const resource = m[1];
    const action = m[2];
    if (!resource || !action) continue;
    if (action === '*') {
      return [
        [resource.toLowerCase(), 'read'],
        [resource.toLowerCase(), 'write'],
        [resource.toLowerCase(), 'search'],
      ];
    }
    const a: FhirAction = action === 'read' || action === 'write' || action === 'search' ? action : 'read';
    return [[resource.toLowerCase(), a]];
  }
  return [];
}

/**
 * Builds a set of allowed (resourceType, action) from a list of scope strings.
 * Resource type normalized to PascalCase (e.g. Patient, Observation).
 */
function buildAllowedSet(scopes: string[]): Set<string> {
  const set = new Set<string>();
  for (const scope of scopes) {
    const pairs = scopeToResourceAction(scope);
    for (const [resourceType, action] of pairs) {
      set.add(`${resourceType.toLowerCase()}:${action}`);
      if (resourceType === '*') {
        ['Patient', 'Observation', 'Device', 'Encounter', 'Condition'].forEach((r) => {
          set.add(`${r.toLowerCase()}:${action}`);
        });
      }
    }
  }
  return set;
}

/**
 * Returns true if the given scopes allow the requested resource type and action.
 * Use after parsing Authorization scopes (e.g. from requestContext.authorizer.scopes).
 */
export function isScopeAllowed(
  scopes: string[],
  resourceType: string,
  action: FhirAction
): boolean {
  if (!scopes?.length) return false;
  const normalizedResource = resourceType.toLowerCase();
  const allowed = buildAllowedSet(scopes);
  return (
    allowed.has(`${normalizedResource}:${action}`) ||
    allowed.has(`*:${action}`)
  );
}
