import { LambdaRequest, withLambdaHandler } from '@api-hub/utils';
import { patchRelationSchema } from '../schemas/patchRelation.schema';
import { updateRelationStatusById } from '../services/relationService';

export const main = withLambdaHandler(async (req: LambdaRequest) => {
  const input = patchRelationSchema.parse(req);
  return updateRelationStatusById(input.pk, input.sk, input.status, input.userId);
});
