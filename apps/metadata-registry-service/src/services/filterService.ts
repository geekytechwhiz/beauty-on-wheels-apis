import type { MetadataValueRecord, ValueSearchFilter } from '@api-hub/metadata';
import { getMetadataRepository } from '../repositories/dynamodb';

/**
 * POST /metadata-types/{metadataTypeCode}/values/search — applicability filtering (in-memory).
 */
export async function searchValues(metadataTypeCode: string, filter: ValueSearchFilter): Promise<MetadataValueRecord[]> {
  return (await getMetadataRepository()).searchMetadataValues(metadataTypeCode, filter);
}
