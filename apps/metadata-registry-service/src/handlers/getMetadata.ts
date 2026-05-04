import {
  resolveMetadataTypeGet,
  resolveMetadataValueGetForApi,
  ValidationError,
} from '@api-hub/metadata';
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

  if (input.entityType === 'value') {
    const record = await resolveMetadataValueGetForApi(input.metadataTypeCode, input.valueCode, input.mode);
    const userMap = await getUsersByIds(collectUserIdsForEnrichment(record));
    return enrichMetadataRecordActors(record, userMap);
  }

  throw new ValidationError('entityType must be "type" or "value"', [
    { field: 'entityType', message: 'Must be "type" or "value"' },
  ]);
});
