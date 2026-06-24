import { orchestrateRegistryDeleteMetadataValue } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';

import { deleteMetadataValueSchema } from '../schemas/deleteMetadataValue.schema';

export const main = withLambdaHandler(async (req) => {
  const input = deleteMetadataValueSchema.parse(req);
  return orchestrateRegistryDeleteMetadataValue({
    metadataTypeCode: input.metadataTypeCode,
    valueCode: input.valueCode,
    userId: input.userId,
    reason: input.reason,
    action: input.action,
    body: input.body,
  });
});
