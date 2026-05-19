import type { MetadataTypeInput, MetadataValueInput } from '@api-hub/metadata';
import {
  flattenMetadataValueForApi,
  getValue,
  normalizeMetadataTypeInput,
  normalizeMetadataValueInput,
  upsertMetadataType,
  upsertMetadataValue,
  ValidationError,
} from '@api-hub/metadata';
import { postMetadataSchema } from '../../schemas/postMetadata.schema';
import {   withApiHandler, successResponse } from "@api-hub/middleware";

export const main =   withApiHandler(
          {
            operation: 'postMetadata',
            
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await ((async (req) => {
          const input = postMetadataSchema.parse(req);

          if (input.entityType === 'type') {
            const body = input.body;
            return upsertMetadataType(
              normalizeMetadataTypeInput(body as MetadataTypeInput & Record<string, unknown>),
              input.userId,
            );
          }

          if (input.entityType === 'value') {
            const raw = input.body as MetadataValueInput & Record<string, unknown>;
            const metadataTypeCode = String(raw.metadataTypeCode).trim();
            const valueCode = (raw.valueCode ?? raw.metadataValueCode) as string;
            const existing = await getValue(metadataTypeCode, valueCode);
            const normalized = normalizeMetadataValueInput(
              { ...raw, valueCode, metadataValueCode: valueCode } as MetadataValueInput & Record<string, unknown>,
              existing,
            );
            const record = await upsertMetadataValue(metadataTypeCode, normalized, input.userId, existing);
            return flattenMetadataValueForApi(record);
          }

          throw new ValidationError('entityType must be "type" or "value"', [
            { field: 'entityType', message: 'Must be "type" or "value"' },
          ]);
        }) as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
