import { withLambdaHandler } from '@api-hub/utils';
import { postRelationSchema } from '../schemas/postRelation.schema';
import { createMetadataRelation } from '../services/relationService';

export const main = withLambdaHandler(
  async (req) => {
    const input = postRelationSchema.parse(req);
    return createMetadataRelation(input.body, input.userId);
  },
  { useCreated: true },
);
