import {
  assertMetadataPublishRequestBody,
  assertMetadataTypeCodePresentOnBody,
  assertRegistryEntityKind,
  assertRegistryPostMetadataAction,
  assertValueCodePresentOnPatchBody,
  extractRegistryEntityPath,
} from '@api-hub/metadata';
import { z } from 'zod';

function isDraftImpactPreviewBody(body: Record<string, unknown>): boolean {
  const id = body.changeRequestId;
  return typeof id === 'string' && id.trim() !== '';
}

/**
 * POST `/metadata/:entityType` schema.
 *
 * Schema responsibility (intentionally narrow):
 *   1. parse request envelope (params / pathParameters / body / context)
 *   2. validate `entityType` routing invariant (`type` | `value`)
 *   3. assert minimal field presence required for orchestration safety
 *
 * `action=draft` and stateless `action=impact-preview` require metadata body fields.
 * `action=impact-preview` with `{ changeRequestId }` only requires the draft id.
 * `action=publish` requires `{ changeRequestId, confirmationAcknowledged, expectedBaseVersion }`.
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
    const actionRaw = String(q.action ?? '');
    return { entityTypeRaw, kind, userId, body, actionRaw };
  })
  .superRefine((data) => {
    const kind = assertRegistryEntityKind(data.entityTypeRaw);
    const action = assertRegistryPostMetadataAction(data.actionRaw);

    if (action === 'publish') {
      assertMetadataPublishRequestBody(data.body);
      return;
    }

    if (action === 'impact-preview' && isDraftImpactPreviewBody(data.body)) {
      return;
    }

    assertMetadataTypeCodePresentOnBody(data.body);
    if (kind === 'value') {
      assertValueCodePresentOnPatchBody(data.body);
    }
  })
  .transform((data) => {
    const action = assertRegistryPostMetadataAction(data.actionRaw);
    if (data.kind === 'type') {
      return {
        entityType: 'type' as const,
        userId: data.userId,
        body: data.body,
        action,
      };
    }
    return {
      entityType: 'value' as const,
      userId: data.userId,
      body: data.body,
      action,
    };
  });

export type PostMetadataInput = z.infer<typeof postMetadataSchema>;
