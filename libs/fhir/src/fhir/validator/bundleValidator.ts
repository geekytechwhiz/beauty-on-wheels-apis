import { validateWithHl7 } from './hl7Validator';

export async function validateBundle(resource: unknown): Promise<void> {
  if (!resource || typeof resource !== 'object') {
    throw new Error('FHIR Bundle payload must be an object');
  }

  const bundle = resource as {
    resourceType?: unknown;
    type?: unknown;
    entry?: unknown;
  };

  if (bundle.resourceType !== 'Bundle') {
    throw new Error('FHIR Bundle validation failed: resourceType must be "Bundle"');
  }

  if (bundle.type !== 'searchset') {
    throw new Error('FHIR Bundle validation failed: type must be "searchset"');
  }

  if (!Array.isArray(bundle.entry)) {
    throw new Error('FHIR Bundle validation failed: entry must be an array');
  }

  await validateWithHl7(resource);
}
