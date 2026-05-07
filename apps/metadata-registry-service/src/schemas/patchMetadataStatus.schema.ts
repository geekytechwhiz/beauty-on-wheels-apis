import {
  assertMetadataTypeCodePresentOnBody,
  assertRegistryEntityKind,
  assertValueCodePresentOnPatchBody,
} from '@api-hub/metadata';import { z } from 'zod';

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
    const kind = assertRegistryEntityKind(data.entityTypeRaw);
    const b = (data.body ?? {}) as Record<string, unknown>;
    if (kind === 'type') {
      assertMetadataTypeCodePresentOnBody(b);
      return;
    }
    assertMetadataTypeCodePresentOnBody(b);
    assertValueCodePresentOnPatchBody(b);
  })
  .transform((data) => {
    const b = (data.body ?? {}) as Record<string, unknown>;
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
