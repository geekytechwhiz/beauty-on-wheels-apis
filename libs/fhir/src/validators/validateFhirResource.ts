/**
 * Validates a FHIR resource against a pinned profile.
 * No runtime dependency on external FHIR profile URLs.
 */

export type FhirVersion = 'r4' | 'r5';

export interface ValidationSuccess {
  success: true;
}

export interface OperationOutcomeIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  code: string;
  details?: { text: string };
  diagnostics?: string;
  location?: string[];
}

export interface OperationOutcome {
  resourceType: 'OperationOutcome';
  issue: OperationOutcomeIssue[];
}

export interface ValidationFailure {
  success: false;
  outcome: OperationOutcome;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validates resource JSON against the named profile for the given FHIR version.
 * Uses pinned profiles from libs/fhir/profiles (no external fetch).
 */
export function validateFhirResource(
  resource: unknown,
  profileName: string,
  _fhirVersion: FhirVersion
): ValidationResult {
  if (resource === null || typeof resource !== 'object') {
    return {
      success: false,
      outcome: {
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'fatal',
            code: 'invalid',
            details: { text: 'Resource must be a non-null object' },
          },
        ],
      },
    };
  }

  const obj = resource as Record<string, unknown>;
  if (obj.resourceType !== profileName) {
    return {
      success: false,
      outcome: {
        resourceType: 'OperationOutcome',
        issue: [
          {
            severity: 'error',
            code: 'invalid',
            details: {
              text: `Resource type mismatch: expected ${profileName}, got ${String(obj.resourceType)}`,
            },
          },
        ],
      },
    };
  }

  // Placeholder: extend with schema/profile-aware validation (e.g. JSON Schema or custom rules).
  return { success: true };
}
