export interface FhirBundleEntry {
  fullUrl: string;
  resource: Record<string, unknown>;
}

export interface FhirCollectionBundle {
  resourceType: 'Bundle';
  type: 'collection';
  id?: string;
  entry: FhirBundleEntry[];
}
