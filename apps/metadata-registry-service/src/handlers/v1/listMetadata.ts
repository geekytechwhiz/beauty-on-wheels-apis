import { metadataService, ValidationError } from '@api-hub/metadata';
import { listMetadataSchema } from '../../schemas/listMetadata.schema';
import {   withApiHandler, successResponse } from "@api-hub/middleware";

export const main =   withApiHandler(
          {
            operation: 'listMetadata',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await ((async (req) => {
          const input = listMetadataSchema.parse(req);

          if (input.entityType === 'type') {
            return metadataService.listTypes(input);
          }

          if (input.entityType === 'value') {
            return metadataService.listValues(input);
          }

          throw new ValidationError('entityType must be "type" or "value"', [
            { field: 'entityType', message: 'Must be "type" or "value"' },
          ]);
        }) as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
