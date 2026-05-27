export interface FhirBundleEntry {
  resource: Record<string, unknown>;
}

export interface FhirCollectionBundle {
  resourceType: 'Bundle';
  type: 'collection';
  entry: FhirBundleEntry[];
}
