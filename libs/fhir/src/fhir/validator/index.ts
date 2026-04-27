import { validateBundle } from './bundleValidator';
import { validateWithHl7 } from './hl7Validator';
import { validatePatient } from './patientValidator';

type FhirLikeResource = {
  resourceType?: unknown;
};

export async function validateFhirResponse(resource: unknown): Promise<void> {
  if (!resource || typeof resource !== 'object') {
    throw new Error('FHIR validation failed: response payload must be an object');
  }

  const fhirResource = resource as FhirLikeResource;

  if (typeof fhirResource.resourceType !== 'string' || fhirResource.resourceType.trim() === '') {
    throw new Error('FHIR validation failed: missing resourceType');
  }

  switch (fhirResource.resourceType) {
    case 'Patient':
      await validatePatient(resource);
      return;
    case 'Bundle':
      await validateBundle(resource);
      return;
    case 'CapabilityStatement':
    case 'Observation':
    case 'Practitioner':
    case 'RelatedPerson':
    case 'Organization':
    case 'PractitionerRole':
    case 'Appointment':
      await validateWithHl7(resource);
      return;
    case 'OperationOutcome':
      await validateWithHl7(resource);
      return;
    default:
      throw new Error(
        `FHIR validation failed: unsupported resourceType "${fhirResource.resourceType}"`
      );
  }
}
