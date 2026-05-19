import { listTypeAudit, listValueAudit, ValidationError } from '@api-hub/metadata';
import { listMetadataAuditSchema } from '../../schemas/listMetadataAudit.schema';
import {   withApiHandler, successResponse } from "@api-hub/middleware";

export const main =   withApiHandler(
          {
            operation: 'listMetadataAudit',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await ((async (req) => {
            const input = listMetadataAuditSchema.parse(req);

            if (input.entityType === 'type') {
              return listTypeAudit(input.metadataTypeCode);
            }

            if (input.entityType === 'value') {
              return listValueAudit(input.metadataTypeCode, input.valueCode);
            }

            throw new ValidationError('entityType must be "type" or "value"', [
              { field: 'entityType', message: 'Must be "type" or "value"' },
            ]);
          }) as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
