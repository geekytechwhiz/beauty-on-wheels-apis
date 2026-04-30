import type { CreateMetadataRelationInput } from '@api-hub/metadata';
import { z } from 'zod';

export const postRelationSchema = z
  .object({
    body: z.unknown().optional(),
    context: z
      .object({
        userContext: z.object({ userId: z.string().optional() }).optional(),
      })
      .optional(),
  })
  .transform((req) => {
    const body = (req.body ?? {}) as CreateMetadataRelationInput;
    return {
      body,
      userId: req.context?.userContext?.userId,
    };
  });

export type PostRelationInput = z.infer<typeof postRelationSchema>;
