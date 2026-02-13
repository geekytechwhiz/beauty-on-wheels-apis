/**
 * Maps canonical ObservationValue to FHIR R4 Observation.
 * Deterministic and profile-aware (r4).
 * Uses terminology lib to map internal codes to standard systems (e.g. LOINC) when registered.
 */
import type { ObservationValue } from '@api-hub/canonical';
import { mapCode } from '@api-hub/terminology';

export type FhirVersion = 'r4' | 'r5';

export interface FhirObservation {
  resourceType: 'Observation';
  id?: string;
  meta?: { profile?: string[] };
  status: string;
  code?: { coding?: Array<{ system?: string; code?: string; display?: string }> };
  subject?: { reference: string };
  effectiveDateTime?: string;
  valueQuantity?: {
    value: number;
    unit?: string;
    system?: string;
    code?: string;
  };
  valueCodeableConcept?: {
    coding?: Array<{ system?: string; code?: string; display?: string }>;
  };
  device?: { reference?: string };
}

/**
 * Maps canonical ObservationValue to FHIR Observation. Deterministic for given profile/version.
 */
export function canonicalToFhirObservation(
  canonical: ObservationValue,
  _profileName: string = 'Observation',
  _fhirVersion: FhirVersion = 'r4'
): FhirObservation {
  const observation: FhirObservation = {
    resourceType: 'Observation',
    id: canonical.id,
    status: canonical.status ?? 'final',
    subject: { reference: `Patient/${canonical.subjectId}` },
    effectiveDateTime: canonical.effectiveDateTime,
  };

  if (canonical.code || canonical.display || canonical.system) {
    const codings: Array<{ system?: string; code?: string; display?: string }> = [];
    const internalSystem = canonical.system ?? 'http://internal';
    const mapped = canonical.code
      ? mapCode(canonical.code, internalSystem, 'http://loinc.org')
      : undefined;
    if (mapped) {
      codings.push({ system: mapped.system, code: mapped.code, display: mapped.display });
    }
    codings.push({
      system: canonical.system,
      code: canonical.code,
      display: canonical.display,
    });
    observation.code = { coding: codings };
  }

  if (canonical.valueQuantity) {
    observation.valueQuantity = {
      value: canonical.valueQuantity.value,
      unit: canonical.valueQuantity.unit,
      system: canonical.valueQuantity.system,
      code: canonical.valueQuantity.code,
    };
  }

  if (canonical.valueCodeableConcept) {
    observation.valueCodeableConcept = {
      coding: [
        {
          system: canonical.valueCodeableConcept.system,
          code: canonical.valueCodeableConcept.code,
          display: canonical.valueCodeableConcept.display,
        },
      ],
    };
  }

  if (canonical.deviceReadingId) {
    observation.device = { reference: `Device/${canonical.deviceReadingId}` };
  }

  return observation;
}
