import { postRelationSchema } from '../../schemas/postRelation.schema';
import { createMetadataRelation } from '../../services/relationService';
import {   withApiHandler, createdResponse } from "@api-hub/middleware";

export const main =   withApiHandler(
          {
            operation: 'postRelation',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await ((async (req) => {
            const input = postRelationSchema.parse(req);
            return createMetadataRelation(input.body, input.userId);
          }) as any)(req);

            return createdResponse(result, undefined, { correlationId });
          }
        );
