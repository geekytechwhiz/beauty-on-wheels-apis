import type { FhirCollectionBundle } from '../types/fhir-bundle';

export class BundleBuilder {
  build(resources: Record<string, unknown>[]): FhirCollectionBundle {
    return {
      resourceType: 'Bundle',
      type: 'collection',
      entry: resources.map((resource) => ({ resource })),
    };
  }
}
