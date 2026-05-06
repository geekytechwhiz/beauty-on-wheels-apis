import {
  metadataService,
  type MetadataTypeListItem,
  type MetadataValueApiModel,
  ValidationError,
} from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { listMetadataSchema } from '../schemas/listMetadata.schema';
import {
  collectUserIdsForEnrichment,
  enrichMetadataRecordActors,
  getUsersByIds,
} from '../services/userLookup.service';

export const main = withLambdaHandler(async (req) => {
  const input = listMetadataSchema.parse(req);

  if (input.entityType === 'type') {
    const records: MetadataTypeListItem[] = await metadataService.listTypes(input);
    const userMap = await getUsersByIds(collectUserIdsForEnrichment(records));
    return records.map((row) => enrichMetadataRecordActors(row, userMap));
  }

  if (input.entityType === 'value') {
    const records: MetadataValueApiModel[] = await metadataService.listValues(input);
    const userMap = await getUsersByIds(collectUserIdsForEnrichment(records));
    return records.map((row) => enrichMetadataRecordActors(row, userMap));
  }

  throw new ValidationError('entityType must be "type" or "value"', [
    { field: 'entityType', message: 'Must be "type" or "value"' },
  ]);
});
