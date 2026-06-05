import { METADATA_TYPE_CODE_PATTERN, METADATA_VALUE_CODE_PATTERN, ValidationError } from '@api-hub/metadata';
import { z } from 'zod';

const DELETE_REASON_MAX = 2000;

/**
 * PATCH `/metadata-values/{metadataTypeCode}/{metadataValueCode}/delete`
 */
export const deleteMetadataValueSchema = z
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
    const p = req.pathParameters ?? {};
    const metadataTypeCode = String(p.metadataTypeCode ?? '').trim();
    const valueCode = String(p.metadataValueCode ?? p.valueCode ?? '').trim();
    const userId = req.context?.userContext?.userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = body.reason;
    let reason: string | undefined;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      reason = String(raw).trim();
    }
    return { metadataTypeCode, valueCode, userId, reason };
  })
  .superRefine((data) => {
    if (!data.metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required in path', [
        { field: 'metadataTypeCode', message: 'Required' },
      ]);
    }
    if (!data.valueCode) {
      throw new ValidationError('metadataValueCode is required in path', [
        { field: 'metadataValueCode', message: 'Required' },
      ]);
    }
    if (!METADATA_TYPE_CODE_PATTERN.test(data.metadataTypeCode)) {
      throw new ValidationError('Invalid metadataTypeCode', [{ field: 'metadataTypeCode', message: 'Invalid' }]);
    }
    if (!METADATA_VALUE_CODE_PATTERN.test(data.valueCode)) {
      throw new ValidationError('Invalid metadataValueCode', [{ field: 'metadataValueCode', message: 'Invalid' }]);
    }
    if (data.reason !== undefined && data.reason.length > DELETE_REASON_MAX) {
      throw new ValidationError(`reason must be at most ${DELETE_REASON_MAX} characters`, [
        { field: 'reason', message: `Max ${DELETE_REASON_MAX} characters` },
      ]);
    }
  });

export type DeleteMetadataValueRequest = z.infer<typeof deleteMetadataValueSchema>;
