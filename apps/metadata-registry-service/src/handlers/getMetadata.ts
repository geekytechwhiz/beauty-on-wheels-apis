import { orchestrateRegistryGet } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { getMetadataSchema } from '../schemas/getMetadata.schema';
import {
  collectUserIdsForEnrichment,
  enrichMetadataRecordActors,
  getUsersByIds,
} from '../services/userLookup.service';

export const main = withLambdaHandler(async (req) => {
  const input = getMetadataSchema.parse(req);
  const record = await orchestrateRegistryGet(input);
  const userMap = await getUsersByIds(collectUserIdsForEnrichment(record));
  return enrichMetadataRecordActors(record, userMap);
});
