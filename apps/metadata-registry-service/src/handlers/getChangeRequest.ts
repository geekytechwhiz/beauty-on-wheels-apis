import { orchestrateRegistryGetDraftChangeRequest } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { getChangeRequestSchema } from '../schemas/getChangeRequest.schema';
import {
  collectUserIdsForEnrichment,
  enrichMetadataRecordActors,
  getUsersByIds,
} from '../services/userLookup.service';

export const main = withLambdaHandler(async (req) => {
  const { changeRequestId } = getChangeRequestSchema.parse(req);
  const record = await orchestrateRegistryGetDraftChangeRequest(changeRequestId);
  const userMap = await getUsersByIds(collectUserIdsForEnrichment(record));
  return enrichMetadataRecordActors(record, userMap);
});
