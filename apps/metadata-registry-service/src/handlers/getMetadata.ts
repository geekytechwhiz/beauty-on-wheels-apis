import { resolveMetadataTypeGet, resolveMetadataValueGetForApi } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { getMetadataSchema } from '../schemas/getMetadata.schema';
import {
  collectUserIdsForEnrichment,
  enrichMetadataRecordActors,
  getUsersByIds,
} from '../services/userLookup.service';

export const main = withLambdaHandler(async (req) => {
  const input = getMetadataSchema.parse(req);

  if (input.entityType === 'type') {
    const record = await resolveMetadataTypeGet(input.metadataTypeCode, input.mode);
    const userMap = await getUsersByIds(collectUserIdsForEnrichment(record));
    return enrichMetadataRecordActors(record, userMap);
  }

  const record = await resolveMetadataValueGetForApi(input.metadataTypeCode, input.valueCode, input.mode);
  const userMap = await getUsersByIds(collectUserIdsForEnrichment(record));
  return enrichMetadataRecordActors(record, userMap);
});
