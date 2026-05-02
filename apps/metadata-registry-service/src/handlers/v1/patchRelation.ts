import { patchRelationSchema } from '../../schemas/patchRelation.schema';
import { inactivateRelationById } from '../../services/relationService';
import {   withApiHandler, successResponse } from "@api-hub/middleware";

export const main =   withApiHandler(
          {
            operation: 'patchRelation',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await ((async (req) => {
          const input = patchRelationSchema.parse(req);
          return inactivateRelationById(input.id, input.userId);
        }) as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
