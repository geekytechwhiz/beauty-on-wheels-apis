import { MetadataRegistryService } from '@api-hub/metadata';
import { ddbDocClient } from '@api-hub/utils';

const TABLE_NAME = process.env.METADATA_REGISTRY_TABLE!;
const EVENT_BUS = process.env.EVENT_BUS;

let instance: MetadataRegistryService | null = null;

export function getService(): MetadataRegistryService {
  if (!instance) {
    instance = new MetadataRegistryService(ddbDocClient, TABLE_NAME, EVENT_BUS);
  }
  return instance;
}
