import {
  orchestrateRegistryList,
  type MetadataTypeListItem,
  type MetadataValueApiModel,
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
  const records = await orchestrateRegistryList(input);
  const userMap = await getUsersByIds(collectUserIdsForEnrichment(records));
  return records.map((row: MetadataTypeListItem | MetadataValueApiModel) =>
    enrichMetadataRecordActors(row, userMap),
  );
});
