export interface PatientSearchParams {
  name?: string;
  birthdate?: string;
  id?: string;
  _id?: string;
  [key: string]: string | undefined;
}

export interface PatientSearchQuery {
  id?: string;
  firstName?: string;
  lastName?: string;
  birthDate?: string;
}

/**
 * Convert FHIR Patient search parameters into a domain-level query object.
 *
 * - name      → firstName / lastName (best-effort split on first space)
 * - birthdate → birthDate
 * - id/_id    → id
 */
export function parsePatientSearch(
  params: PatientSearchParams
): PatientSearchQuery {
  const name = params.name;
  let firstName: string | undefined;
  let lastName: string | undefined;

  if (name) {
    const parts = name.trim().split(/\s+/);
    firstName = parts[0];
    if (parts.length > 1) {
      lastName = parts.slice(1).join(' ');
    }
  }

  const birthDate = params.birthdate;
  const id = params._id ?? params.id;

  return {
    id,
    firstName,
    lastName,
    birthDate,
  };
}

