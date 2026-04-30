import { parseGetEntityStatusMode, ValidationError } from '@api-hub/metadata';
import { z } from 'zod';

export const getMetadataSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const entityTypeRaw = (q.entityType ?? p.entityType ?? '').trim();
    const kind = entityTypeRaw.toLowerCase();
    const metadataTypeCode = (q.metadataTypeCode ?? p.metadataTypeCode ?? '').trim();
    const valueCode = (
      q.metadataValueCode ??
      q.valueCode ??
      p.metadataValueCode ??
      ''
    ).trim();
    const mode = parseGetEntityStatusMode(q);
    return { entityTypeRaw, kind, metadataTypeCode, valueCode, mode };
  })
  .superRefine((data) => {
    if (!data.entityTypeRaw) {
      throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
    }
    if (data.kind === 'type') {
      if (!data.metadataTypeCode) {
        throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
      }
      return;
    }
    if (data.kind === 'value') {
      if (!data.metadataTypeCode) {
        throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
      }
      if (!data.valueCode) {
        throw new ValidationError('metadataValueCode is required', [{ field: 'metadataValueCode', message: 'Required' }]);
      }
      return;
    }
    throw new ValidationError('entityType must be "type" or "value"', [
      { field: 'entityType', message: 'Must be "type" or "value"' },
    ]);
  })
  .transform((data) => {
    if (data.kind === 'type') {
      return {
        entityType: 'type' as const,
        metadataTypeCode: data.metadataTypeCode,
        mode: data.mode,
      };
    }
    return {
      entityType: 'value' as const,
      metadataTypeCode: data.metadataTypeCode,
      valueCode: data.valueCode,
      mode: data.mode,
    };
  });

export type GetMetadataInput = z.infer<typeof getMetadataSchema>;
