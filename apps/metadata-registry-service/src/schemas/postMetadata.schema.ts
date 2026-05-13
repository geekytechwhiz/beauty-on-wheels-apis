import {
  assertMetadataTypeCodePresentOnBody,
  assertRegistryEntityKind,
  assertValueCodePresentOnPatchBody,
  extractRegistryEntityPath,
} from '@api-hub/metadata';
import { z } from 'zod';

/**
 * POST `/metadata/:entityType` schema.
 *
 * Schema responsibility (intentionally narrow):
 *   1. parse request envelope (params / pathParameters / body / context)
 *   2. validate `entityType` routing invariant (`type` | `value`)
 *   3. assert minimal field presence required for orchestration safety
 *      (the orchestrator reads `metadataTypeCode` and the value identity directly off the body)
 *
 * Business validation — label, status enum, isGlobal, applicability shape, valueCode pattern,
 * type-specific attribute rules, etc. — lives in `validateMetadataValueInput` /
 * `validateMetadataTypeInput` in the metadata library so the rules have a single source of
 * truth and ValidationError shapes stay consistent across POST/PATCH/list/get flows.
 */
export const postMetadataSchema = z
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
    const { entityTypeRaw, kind } = extractRegistryEntityPath(q, p);
    const userId = req.context?.userContext?.userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    return { entityTypeRaw, kind, userId, body };
  })
  .superRefine((data) => {
    const kind = assertRegistryEntityKind(data.entityTypeRaw);
    assertMetadataTypeCodePresentOnBody(data.body);
    if (kind === 'value') {
      assertValueCodePresentOnPatchBody(data.body);
    }
  })
  .transform((data) => {
    if (data.kind === 'type') {
      return { entityType: 'type' as const, userId: data.userId, body: data.body };
    }
    return { entityType: 'value' as const, userId: data.userId, body: data.body };
  });

export type PostMetadataInput = z.infer<typeof postMetadataSchema>;
