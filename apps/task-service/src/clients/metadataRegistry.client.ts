import { getMetadataRegistryServiceClient } from '@api-hub/service-clients';

import type { MetadataValuesByTypesRequestDto, TaskMetadataReader } from '../metadata';

/** Thin adapter over `@api-hub/service-clients` for task metadata label enrichment. */
export class MetadataRegistryClient implements TaskMetadataReader {
  private readonly client = getMetadataRegistryServiceClient();

  getValuesByTypes(request: MetadataValuesByTypesRequestDto, authHeader: string) {
    return this.client.getValuesByTypes(request.metadataTypeCodes, authHeader);
  }
}

let registryClient: MetadataRegistryClient | undefined;

export function getMetadataRegistryClient(): MetadataRegistryClient {
  if (!registryClient) {
    registryClient = new MetadataRegistryClient();
  }
  return registryClient;
}
