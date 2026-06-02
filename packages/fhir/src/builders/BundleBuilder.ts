import { randomUUID } from 'node:crypto';

import { DEFAULT_FHIR_SERVER_BASE } from '../constants/fhir-server';
import type { FhirCollectionBundle } from '../types/fhir-bundle';

function resolveEntryFullUrl(
  resource: Record<string, unknown>,
  baseUrl: string,
): string {
  const resourceType = String(resource.resourceType ?? 'Resource');
  const id = resource.id;

  if (typeof id === 'string' && id.trim() !== '') {
    return `${baseUrl}/${resourceType}/${encodeURIComponent(id.trim())}`;
  }

  return `urn:uuid:${randomUUID()}`;
}

export class BundleBuilder {
  constructor(private readonly baseUrl: string = DEFAULT_FHIR_SERVER_BASE) {}

  build(resources: Record<string, unknown>[]): FhirCollectionBundle {
    return {
      resourceType: 'Bundle',
      type: 'collection',
      entry: resources.map((resource) => ({
        fullUrl: resolveEntryFullUrl(resource, this.baseUrl),
        resource,
      })),
    };
  }
}
