import { orchestrateRegistryPatchStatus } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { patchMetadataStatusSchema } from '../schemas/patchMetadataStatus.schema';

export const main = withLambdaHandler(async (req) => {
  const input = patchMetadataStatusSchema.parse(req);
  return orchestrateRegistryPatchStatus(input);
});
