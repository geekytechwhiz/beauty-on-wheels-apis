import { ValidationError, decodeRelationId } from '@api-hub/metadata';
import { z } from 'zod';

export const patchRelationSchema = z
  .object({
    params: z.record(z.string(), z.string().optional()).optional(),
    pathParameters: z.record(z.string(), z.string().optional()).optional(),
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
      return { pk, sk, userId: data.userId };
    } catch {
      throw new ValidationError('Invalid relation id', [{ field: 'id', message: 'Invalid' }]);
    }
  });

export type PatchRelationInput = z.infer<typeof patchRelationSchema>;
