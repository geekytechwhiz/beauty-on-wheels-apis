import { ValidationError } from '@api-hub/metadata';
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
    if (!data.id) {
      throw new ValidationError('id is required', [{ field: 'id', message: 'Required' }]);
    }
  });

export type PatchRelationInput = z.infer<typeof patchRelationSchema>;
