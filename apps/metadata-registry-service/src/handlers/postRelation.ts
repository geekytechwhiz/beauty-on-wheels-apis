import type { CreateMetadataRelationInput } from '@api-hub/metadata';
import { withLambdaHandler } from '@api-hub/utils';
import { createMetadataRelation } from '../services/relationService';

export const main = withLambdaHandler(
  async (req: {
    body?: CreateMetadataRelationInput;
    context?: { userContext?: { userId?: string } };
  }) => {
    const body = (req.body ?? {}) as CreateMetadataRelationInput;
    return createMetadataRelation(body, req.context?.userContext?.userId);
  },
  { useCreated: true },
);
