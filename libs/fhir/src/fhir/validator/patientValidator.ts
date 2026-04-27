import { validateWithHl7 } from './hl7Validator';

export async function validatePatient(resource: unknown): Promise<void> {
  if (!resource || typeof resource !== 'object') {
    throw new Error('FHIR Patient payload must be an object');
  }

  const patient = resource as { resourceType?: unknown };
  if (patient.resourceType !== 'Patient') {
    throw new Error('FHIR Patient validation failed: resourceType must be "Patient"');
  }

  await validateWithHl7(resource);
}
