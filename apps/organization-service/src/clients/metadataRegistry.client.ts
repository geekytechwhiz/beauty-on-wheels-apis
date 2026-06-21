import { getMetadataRegistryServiceClient } from '@api-hub/service-clients';
import type { OrgConfigMetadataReader } from '../utils/organizationConfig.validator';

/** Thin adapter over `@api-hub/service-clients` for org config publish validation. */
export class MetadataRegistryClient implements OrgConfigMetadataReader {
  private readonly client = getMetadataRegistryServiceClient();

  getValuesByTypes(metadataTypeCodes: string[], authHeader: string) {
    return this.client.getValuesByTypes(metadataTypeCodes, authHeader);
  }

  getRelatedValues(
    params: {
      fromType: string;
      fromValues: string[];
      relationType?: string;
      toType?: string;
    },
    authHeader: string,
  ) {
    return this.client.getRelatedValues(params, authHeader);
  }
}

let metadataRegistryClient: OrgConfigMetadataReader | undefined;

export function getMetadataRegistryClient(): OrgConfigMetadataReader {
  if (!metadataRegistryClient) {
    metadataRegistryClient = new MetadataRegistryClient();
  }
  return metadataRegistryClient;
}

export function setMetadataRegistryClientForTests(client: OrgConfigMetadataReader | undefined): void {
  metadataRegistryClient = client;
}
