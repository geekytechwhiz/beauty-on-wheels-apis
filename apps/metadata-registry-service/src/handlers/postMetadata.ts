import { orchestrateRegistryPostDraft } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { postMetadataSchema } from '../schemas/postMetadata.schema';

export const main = withLambdaHandler(async (req) => {
  const input = postMetadataSchema.parse(req);
  return orchestrateRegistryPostDraft(input);
});
