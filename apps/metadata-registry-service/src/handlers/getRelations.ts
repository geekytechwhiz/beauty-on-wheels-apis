import { withLambdaHandler } from '@api-hub/middleware';
import { listRelationsForValue } from '../services/relationService';
import { getRelationsSchema } from '../schemas/getRelations.schema';

export const main = withLambdaHandler(async (req) => {
  const input = getRelationsSchema.parse(req);
  const relations = await listRelationsForValue(input.fromType, input.fromValue, {
    relationType: input.relationType,
    toType: input.toType,
  });
  return { relations };
});
