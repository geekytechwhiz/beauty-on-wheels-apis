import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { listRelationsForValue } from '../../services/relationService';
import { getRelationsSchema } from '../../schemas/getRelations.schema';

export const main =   withApiHandler(
          {
            operation: 'getRelations',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await ((async (req) => {
          const input = getRelationsSchema.parse(req);
          const relations = await listRelationsForValue(input.fromType, input.fromValue, {
            relationType: input.relationType,
            toType: input.toType,
          });
          return { relations };
        }) as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
