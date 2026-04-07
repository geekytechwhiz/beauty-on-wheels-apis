import { ddbDocClient } from '@api-hub/utils';
import { MetadataRegistryService } from '@api-hub/metadata';

let singleton: MetadataRegistryService | null = null;

function getTableName(): string {
  const tableName = process.env.METADATA_REGISTRY_TABLE ?? '';
  if (!tableName) {
    throw new Error('METADATA_REGISTRY_TABLE is not configured');
  }
  return tableName;
}

function getEventBusName(): string {
  return process.env.EVENT_BUS ?? '';
}

export function getMetadataRegistryService(): MetadataRegistryService {
  if (!singleton) {
    const bus = getEventBusName();
    singleton = new MetadataRegistryService(ddbDocClient, getTableName(), bus.length > 0 ? bus : undefined);
  }
  return singleton;
}
