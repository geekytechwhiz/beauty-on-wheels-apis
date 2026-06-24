import {
  assertChangeRequestIdPresentOnBody,
  assertMetadataPublishRequestBody,
  assertMetadataTypeCodePresentOnBody,
  assertRegistryEntityKind,
  assertRegistryPatchMetadataStatusAction,
  assertValueCodePresentOnPatchBody,
  extractRegistryEntityPath,
  parsePatchStatusBody,
} from '@api-hub/metadata';
import { z } from 'zod';

function isDraftImpactPreviewBody(body: Record<string, unknown>): boolean {
  const id = body.changeRequestId;
  return typeof id === 'string' && id.trim() !== '';
}

/**
 * PATCH `/metadata/:entityType/status` schema.
 *
 * Without `action`, validation still requires status fields; orchestration returns
 * `CHANGE_MANAGEMENT_REQUIRED`. With `action=draft|impact-preview|publish`, routes through
 * the governed change-management workflow (same semantics as `POST /metadata/{entityType}`).
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
    const actionRaw = String(q.action ?? '').trim();
    return { entityTypeRaw, kind, userId, body, actionRaw };
  })
  .superRefine((data) => {
    const kind = assertRegistryEntityKind(data.entityTypeRaw);

    if (data.actionRaw) {
      const action = assertRegistryPatchMetadataStatusAction(data.actionRaw);
      if (action === 'publish') {
        assertMetadataPublishRequestBody(data.body);
        return;
      }
      if (action === 'impact-preview' && isDraftImpactPreviewBody(data.body)) {
        assertChangeRequestIdPresentOnBody(data.body);
        return;
      }
    }

    assertMetadataTypeCodePresentOnBody(data.body);
    if (kind === 'value') {
      assertValueCodePresentOnPatchBody(data.body);
    }
    parsePatchStatusBody(data.body.status);
  })
  .transform((data) => {
    const kind = data.kind as 'type' | 'value';
    const action = data.actionRaw ? assertRegistryPatchMetadataStatusAction(data.actionRaw) : undefined;

    if (action === 'publish' || (action === 'impact-preview' && isDraftImpactPreviewBody(data.body))) {
      return {
        entityType: kind,
        userId: data.userId,
        action,
        body: data.body,
      };
    }

    const status = parsePatchStatusBody(data.body.status);
    const metadataTypeCode = String(data.body.metadataTypeCode).trim();

    if (kind === 'type') {
      return {
        entityType: 'type' as const,
        userId: data.userId,
        metadataTypeCode,
        status,
        action,
        body: data.body,
      };
    }

    const valueCode = String((data.body.valueCode ?? data.body.metadataValueCode) ?? '').trim();
    return {
      entityType: 'value' as const,
      userId: data.userId,
      metadataTypeCode,
      valueCode,
      status,
      action,
      body: data.body,
    };
  });

export type PatchMetadataStatusInput = z.infer<typeof patchMetadataStatusSchema>;
