/**
 * Maps canonical ObservationValue to FHIR R4 Observation.
 * Deterministic and profile-aware (r4).
 */
import type { ObservationValue } from '@api-hub/canonical';

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
    observation.code = {
      coding: [
        {
          system: canonical.system,
          code: canonical.code,
          display: canonical.display,
        },
      ],
    };
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
