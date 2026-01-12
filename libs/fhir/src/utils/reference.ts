/**
 * FHIR Reference Utilities
 */

import { Reference } from '../models/r4/common';

/**
 * Create a FHIR reference
 */
export function createReference(
  resourceType: string,
  id: string,
  display?: string
): Reference {
  return {
    reference: `${resourceType}/${id}`,
    type: resourceType,
    ...(display && { display }),
  };
}

/**
 * Create a Patient reference
 */
export function createPatientReference(id: string, display?: string): Reference {
  return createReference('Patient', id, display);
}

/**
 * Create an Organization reference
 */
export function createOrganizationReference(
  id: string,
  display?: string
): Reference {
  return createReference('Organization', id, display);
}

/**
 * Create a Practitioner reference
 */
export function createPractitionerReference(
  id: string,
  display?: string
): Reference {
  return createReference('Practitioner', id, display);
}

/**
 * Create a PractitionerRole reference
 */
export function createPractitionerRoleReference(
  id: string,
  display?: string
): Reference {
  return createReference('PractitionerRole', id, display);
}

