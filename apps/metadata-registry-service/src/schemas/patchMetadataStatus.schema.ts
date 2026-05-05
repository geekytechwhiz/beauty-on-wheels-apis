import { ValidationError } from '@api-hub/metadata';
import { z } from 'zod';

export const patchMetadataStatusSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
    body: z.unknown().optional(),
    context: z
      .object({
        userContext: z.object({ userId: z.string().optional() }).optional(),
      })
      .optional(),
  })
  .transform((req) => {
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const rawEntity = q.entityType ?? p.entityType;
    const entityType = (rawEntity ?? '').trim();
    const kind = entityType.toLowerCase();
    const userId = req.context?.userContext?.userId;
    const body = req.body as Record<string, unknown> | undefined;
    return { entityTypeRaw: entityType, kind, userId, body };
  })
  .superRefine((data) => {
    if (!data.entityTypeRaw) {
      throw new ValidationError('entityType is required in path', [{ field: 'entityType', message: 'Required' }]);
    }
    const b = data.body;
    if (data.kind === 'type') {
      const code = b?.metadataTypeCode;
      if (code === undefined || code === null || String(code).trim() === '') {
        throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
      }
      return;
    }
    if (data.kind === 'value') {
      const metadataTypeCode = b?.metadataTypeCode;
      if (metadataTypeCode === undefined || metadataTypeCode === null || String(metadataTypeCode).trim() === '') {
        throw new ValidationError('metadataTypeCode is required', [{ field: 'metadataTypeCode', message: 'Required' }]);
      }
      const valueCode = (b?.valueCode ?? b?.metadataValueCode) as string | undefined;
      if (valueCode === undefined || valueCode === null || String(valueCode).trim() === '') {
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
    const b = data.body!;
    if (data.kind === 'type') {
      return {
        entityType: 'type' as const,
        userId: data.userId,
        metadataTypeCode: String(b.metadataTypeCode).trim(),
        rawStatus: b.status,
      };
    }
    const valueCode = (b.valueCode ?? b.metadataValueCode) as string;
    return {
      entityType: 'value' as const,
      userId: data.userId,
      metadataTypeCode: String(b.metadataTypeCode).trim(),
      valueCode: String(valueCode).trim(),
      rawStatus: b.status,
    };
  });

export type PatchMetadataStatusInput = z.infer<typeof patchMetadataStatusSchema>;
