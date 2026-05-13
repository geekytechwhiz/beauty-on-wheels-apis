import {
  orchestrateRegistryList,
  type ListMetadataInput,
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
  const parsed = listMetadataSchema.parse(req);
  const result = await orchestrateRegistryList(parsed as ListMetadataInput);
  const userMap = await getUsersByIds(collectUserIdsForEnrichment(result.items));
  const enriched = result.items.map((row: MetadataTypeListItem | MetadataValueApiModel) =>
    enrichMetadataRecordActors(row, userMap),
  );

  if (!result.pagination) {
    return enriched;
  }

  return {
    items: enriched,
    ...(result.nextPaginationKey !== undefined
      ? { nextPaginationKey: result.nextPaginationKey }
      : {}),
  };
});
