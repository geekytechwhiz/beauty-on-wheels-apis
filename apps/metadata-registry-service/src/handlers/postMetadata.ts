import {
  orchestrateRegistryPostDraft,
  orchestrateRegistryPostCancelDraft,
  orchestrateRegistryPostImpactPreview,
  orchestrateRegistryPostPublish,
} from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { postMetadataSchema } from '../schemas/postMetadata.schema';

export const main = withLambdaHandler(async (req) => {
  const input = postMetadataSchema.parse(req);
  if (input.action === 'draft') {
    return orchestrateRegistryPostDraft(input);
  }
  if (input.action === 'cancel') {
    return orchestrateRegistryPostCancelDraft({ ...input, action: 'cancel' });
  }
  if (input.action === 'publish') {
    return orchestrateRegistryPostPublish({ ...input, action: 'publish' });
  }
  return orchestrateRegistryPostImpactPreview(input);
});
