import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { patchRelationSchema } from '../schemas/patchRelation.schema';
import { inactivateRelationById } from '../services/relationService';

export const main =   withApiHandler(
  {
    operation: 'patchRelation',
  },
  async (req) => {
    const correlationId =
      (req.context as { correlationId?: string }).correlationId ?? 'unknown';

  const input = patchRelationSchema.parse(req);
  return inactivateRelationById(input.id, input.userId);
});
