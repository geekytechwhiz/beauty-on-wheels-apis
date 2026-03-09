/**
 * Maps canonical Patient to FHIR R4 Patient.
 * Deterministic and profile-aware (r4).
 */


export type FhirVersion = 'r4' | 'r5';

export interface FhirPatient {
  resourceType: 'Patient';
  id?: string;
  meta?: { profile?: string[] };
  identifier?: Array<{ system?: string; value: string }>;
  active?: boolean;
  name?: Array<{
    family?: string;
    given?: string[];
    use?: string;
  }>;
  telecom?: Array<{
    system: 'phone' | 'email' | 'other';
    value: string;
    use?: string;
  }>;
  gender?: string;
  birthDate?: string;
  address?: Array<{
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
}

/**
 * Maps canonical Patient to FHIR Patient. Deterministic for given profile/version.
 */
export function canonicalToFhirPatient(
  canonical: any,
  _profileName = 'Patient',
  _fhirVersion: FhirVersion = 'r4'
): FhirPatient {
  const patient: FhirPatient = {
    resourceType: 'Patient',
    id: canonical.id,
    active: canonical.active,
  };

  if (canonical.externalId) {
    patient.identifier = [{ value: canonical.externalId }];
  }

  if (canonical.familyName || canonical.givenName) {
    patient.name = [
      {
        family: canonical.familyName,
        given: canonical.givenName ? [canonical.givenName] : undefined,
        use: 'official',
      },
    ];
  }

  const telecom: FhirPatient['telecom'] = [];
  if (canonical.email) {
    telecom.push({ system: 'email', value: canonical.email });
  }
  if (canonical.phone) {
    telecom.push({ system: 'phone', value: canonical.phone });
  }
  if (telecom.length) patient.telecom = telecom;

  if (canonical.gender) patient.gender = canonical.gender;
  if (canonical.birthDate) patient.birthDate = canonical.birthDate;

  if (
    canonical.addressLine ||
    canonical.city ||
    canonical.state ||
    canonical.postalCode ||
    canonical.country
  ) {
    patient.address = [
      {
        line: canonical.addressLine ? [canonical.addressLine] : undefined,
        city: canonical.city,
        state: canonical.state,
        postalCode: canonical.postalCode,
        country: canonical.country,
      },
    ];
  }

  return patient;
}
