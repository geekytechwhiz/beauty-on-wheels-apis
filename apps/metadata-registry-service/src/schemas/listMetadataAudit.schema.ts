import { ValidationError } from '@api-hub/metadata';
import { z } from 'zod';

export const listMetadataAuditSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const rawEntity = q.entityType ?? p.entityType;
    const entityType = (rawEntity ?? '').trim();
    const kind = entityType.toLowerCase();
    const metadataTypeCode = (q.metadataTypeCode ?? p.metadataTypeCode ?? '').trim();
    const valueCode = (
      q.metadataValueCode ?? q.valueCode ?? p.metadataValueCode ?? ''
    ).trim();
    return { entityTypeRaw: entityType, kind, metadataTypeCode, valueCode };
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
        throw new ValidationError('metadataTypeCode and metadataValueCode are required', [
          { field: 'metadataValueCode', message: 'valueCode or metadataValueCode is required' },
        ]);
      }
      return;
    }
    throw new ValidationError('entityType must be "type" or "value"', [
      { field: 'entityType', message: 'Must be "type" or "value"' },
    ]);
  })
  .transform((data) => {
    if (data.kind === 'type') {
      return { entityType: 'type' as const, metadataTypeCode: data.metadataTypeCode };
    }
    return {
      entityType: 'value' as const,
      metadataTypeCode: data.metadataTypeCode,
      valueCode: data.valueCode,
    };
  });

export type ListMetadataAuditInput = z.infer<typeof listMetadataAuditSchema>;
