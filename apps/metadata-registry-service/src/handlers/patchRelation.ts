import { withApiHandler } from '@api-hub/middleware';
import { patchRelationSchema } from '../schemas/patchRelation.schema';
import { inactivateRelationById } from '../services/relationService';

export const main =   withApiHandler(
  {
    operation: 'patchRelation',
  },
  async (req) => {
  

  const input = patchRelationSchema.parse(req);
  return inactivateRelationById(input.id, input.userId);
});
