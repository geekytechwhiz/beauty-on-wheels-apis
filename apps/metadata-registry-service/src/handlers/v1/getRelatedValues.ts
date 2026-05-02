import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { listRelatedValues } from '../../services/relationService';
import { getRelatedValuesSchema } from '../../schemas/getRelatedValues.schema';

/**
 * Returns `{ values: RelatedValueRef[] }` so top-level `data` is an object, not a raw array
 * (avoids `normalizeData` turning arrays into `{ items }` only for this list endpoint).
 */
export const main =   withApiHandler(
          {
            operation: 'getRelatedValues',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await ((async (req) => {
          const input = getRelatedValuesSchema.parse(req);
          const values = await listRelatedValues(input.fromType, input.fromValue, {
            relationType: input.relationType,
            toType: input.toType,
          });
          return { values };
        }) as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
