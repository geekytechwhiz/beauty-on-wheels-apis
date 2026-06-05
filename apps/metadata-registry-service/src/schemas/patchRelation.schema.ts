import { ValidationError, decodeRelationId, RELATION_STATUS, type RelationStatus } from '@api-hub/metadata';
import { z } from 'zod';

function assertRelationPatchStatus(body: unknown): RelationStatus {
  if (body === undefined || body === null || typeof body !== 'object') {
    throw new ValidationError('status is required', [{ field: 'status', message: 'Required' }]);
  }
  const raw = (body as Record<string, unknown>).status;
  if (raw === undefined) {
    throw new ValidationError('status is required', [{ field: 'status', message: 'Required' }]);
  }
  if (raw !== RELATION_STATUS.ACTIVE && raw !== RELATION_STATUS.INACTIVE) {
    throw new ValidationError('status must be ACTIVE or INACTIVE', [
      { field: 'status', message: 'Must be ACTIVE or INACTIVE' },
    ]);
  }
  return raw;
}

export const patchRelationSchema = z
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
    const id = req.params?.id ?? req.pathParameters?.id ?? '';
    return {
      id,
      body: req.body,
      userId: req.context?.userContext?.userId,
    };
  })
  .superRefine((data) => {
    if (!data.id.trim()) {
      throw new ValidationError('id is required', [{ field: 'id', message: 'Required' }]);
    }
  })
  .transform((data) => {
    try {
      const { pk, sk } = decodeRelationId(data.id.trim());
      return { pk, sk, userId: data.userId, body: data.body };
    } catch {
      throw new ValidationError('Invalid relation id', [{ field: 'id', message: 'Invalid' }]);
    }
  })
  .transform((data) => {
    const status = assertRelationPatchStatus(data.body);
    return { pk: data.pk, sk: data.sk, userId: data.userId, status };
  });

export type PatchRelationInput = z.infer<typeof patchRelationSchema>;
