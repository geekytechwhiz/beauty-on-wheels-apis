import {
  assertMetadataTypeCodePresentOnBody,
  assertRegistryEntityKind,
  assertValueCodePresentOnPatchBody,
  extractRegistryEntityPath,
  parsePatchStatusBody,
} from '@api-hub/metadata';
import { z } from 'zod';

/**
 * PATCH `/metadata/:entityType/.../status` schema.
 *
 * Schema responsibility:
 *   1. parse request envelope
 *   2. assert routing invariant (`entityType` ∈ {`type`, `value`}) and required body fields
 *   3. assert status presence + ACTIVE/INACTIVE enum correctness via the shared
 *      `parsePatchStatusBody` helper, so the PATCH validation lifecycle matches POST
 *      (validation runs before orchestration; the orchestrator receives a canonical `Status`).
 *
 * Domain transitions (e.g. INACTIVE → INACTIVE rejection) remain in the service layer where
 * they belong (`assertPatchStatusAllowedForInactiveRecord`).
 */
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
    const status = parsePatchStatusBody(data.body.status);
    const metadataTypeCode = String(data.body.metadataTypeCode).trim();
    if (data.kind === 'type') {
      return {
        entityType: 'type' as const,
        userId: data.userId,
        metadataTypeCode,
        status,
      };
    }
    const valueCode = (data.body.valueCode ?? data.body.metadataValueCode) as string;
    return {
      entityType: 'value' as const,
      userId: data.userId,
      metadataTypeCode,
      valueCode: String(valueCode).trim(),
      status,
    };
  });

export type PatchMetadataStatusInput = z.infer<typeof patchMetadataStatusSchema>;
