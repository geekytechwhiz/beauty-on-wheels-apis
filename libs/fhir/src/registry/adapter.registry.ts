import type { FhirAdapter } from '../adapters/fhir.adapter.interface';

export class AdapterRegistry {
  private readonly adapters = new Map<string, FhirAdapter<any, any>>();

  register(resourceType: string, adapter: FhirAdapter<any, any>): void {
    const key = resourceType.trim();
    if (!key) return;
    this.adapters.set(key, adapter);
  }

  getAdapter<TCanonical, TFhir>(resourceType: string):
    | FhirAdapter<TCanonical, TFhir>
    | undefined {
    const key = resourceType.trim();
    if (!key) return undefined;
    return this.adapters.get(key) as FhirAdapter<TCanonical, TFhir> | undefined;
  }
}

export const defaultAdapterRegistry = new AdapterRegistry();

