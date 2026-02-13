/**
 * Exposure layer: fetch canonical from apps/* and map to FHIR.
 * Gateway never persists canonical data.
 */
import type { Patient, ObservationValue } from '@api-hub/canonical';
import { canonicalToFhirPatient, canonicalToFhirObservation } from '@api-hub/fhir';
import { validateFhirResource } from '@api-hub/fhir';

export type FhirVersion = 'r4' | 'r5';

/**
 * Converts canonical Patient to FHIR Patient and validates.
 */
export function exposePatient(canonical: Patient, fhirVersion: FhirVersion = 'r4') {
  const fhir = canonicalToFhirPatient(canonical, 'Patient', fhirVersion);
  const validation = validateFhirResource(fhir, 'Patient', fhirVersion);
  if (!validation.success) {
    return { success: false as const, outcome: validation.outcome };
  }
  return { success: true as const, resource: fhir };
}

/**
 * Converts canonical ObservationValue to FHIR Observation and validates.
 */
export function exposeObservation(
  canonical: ObservationValue,
  fhirVersion: FhirVersion = 'r4'
) {
  const fhir = canonicalToFhirObservation(canonical, 'Observation', fhirVersion);
  const validation = validateFhirResource(fhir, 'Observation', fhirVersion);
  if (!validation.success) {
    return { success: false as const, outcome: validation.outcome };
  }
  return { success: true as const, resource: fhir };
}
