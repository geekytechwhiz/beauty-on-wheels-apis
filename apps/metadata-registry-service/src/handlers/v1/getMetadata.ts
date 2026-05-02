import {
  resolveMetadataTypeGet,
  resolveMetadataValueGetForApi,
  ValidationError,
} from '@api-hub/metadata';
import { getMetadataSchema } from '../../schemas/getMetadata.schema';
import {   withApiHandler, successResponse } from "@api-hub/middleware";

export const main =   withApiHandler(
          {
            operation: 'getMetadata',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await ((async (req) => {
          const input = getMetadataSchema.parse(req);

          if (input.entityType === 'type') {
            return resolveMetadataTypeGet(input.metadataTypeCode, input.mode);
          }

          if (input.entityType === 'value') {
            return resolveMetadataValueGetForApi(input.metadataTypeCode, input.valueCode, input.mode);
          }

          throw new ValidationError('entityType must be "type" or "value"', [
            { field: 'entityType', message: 'Must be "type" or "value"' },
          ]);
        }) as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
