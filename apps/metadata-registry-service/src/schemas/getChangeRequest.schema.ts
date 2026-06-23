import { assertChangeRequestIdPathParam } from '@api-hub/metadata';
import { z } from 'zod';

export const getChangeRequestSchema = z
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
    const q = req.params ?? {};
    const p = req.pathParameters ?? {};
    const changeRequestIdRaw = q.changeRequestId ?? p.changeRequestId ?? '';
    return {
      changeRequestIdRaw,
      userId: req.context?.userContext?.userId,
    };
  })
  .transform((data) => ({
    changeRequestId: assertChangeRequestIdPathParam(data.changeRequestIdRaw),
    userId: data.userId,
  }));

export type GetChangeRequestInput = z.infer<typeof getChangeRequestSchema>;
