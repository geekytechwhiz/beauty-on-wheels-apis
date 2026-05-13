import { withLambdaHandler } from '@api-hub/middleware';
import { postRelationSchema } from '../schemas/postRelation.schema';
import { createMetadataRelation } from '../services/relationService';

export const main = withLambdaHandler(
  async (req : ReturnType<typeof postRelationSchema.parse>) => {
    const input = postRelationSchema.parse(req);
    return createMetadataRelation(input.body, input.userId);
  },
  { useCreated: true },
);
