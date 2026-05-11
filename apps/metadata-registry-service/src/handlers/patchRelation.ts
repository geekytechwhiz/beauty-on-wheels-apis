import { withLambdaHandler } from '@api-hub/utils';
import { patchRelationSchema } from '../schemas/patchRelation.schema';
import { inactivateRelationById } from '../services/relationService';

export const main = withLambdaHandler(async (req) => {
  const input = patchRelationSchema.parse(req);
  return inactivateRelationById(input.pk, input.sk, input.userId);
});
