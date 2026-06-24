import {
  METADATA_TYPE_CODE_PATTERN,
  METADATA_VALUE_CODE_PATTERN,
  ValidationError,
  assertChangeRequestIdPresentOnBody,
  assertMetadataPublishRequestBody,
  assertRegistryDeleteMetadataValueAction,
} from '@api-hub/metadata';
import { z } from 'zod';

const DELETE_REASON_MAX = 2000;

function isDraftImpactPreviewBody(body: Record<string, unknown>): boolean {
  const id = body.changeRequestId;
  return typeof id === 'string' && id.trim() !== '';
}

/**
 * PATCH `/metadata-values/{metadataTypeCode}/{metadataValueCode}/delete`
 */
export const deleteMetadataValueSchema = z
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
    const metadataTypeCode = String(p.metadataTypeCode ?? '').trim();
    const valueCode = String(p.metadataValueCode ?? p.valueCode ?? '').trim();
    const userId = req.context?.userContext?.userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const actionRaw = String(q.action ?? '').trim();
    const raw = body.reason;
    let reason: string | undefined;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      reason = String(raw).trim();
    }
    return { metadataTypeCode, valueCode, userId, reason, body, actionRaw };
  })
  .superRefine((data) => {
    if (!data.metadataTypeCode) {
      throw new ValidationError('metadataTypeCode is required in path', [
        { field: 'metadataTypeCode', message: 'Required' },
      ]);
    }
    if (!data.valueCode) {
      throw new ValidationError('metadataValueCode is required in path', [
        { field: 'metadataValueCode', message: 'Required' },
      ]);
    }
    if (!METADATA_TYPE_CODE_PATTERN.test(data.metadataTypeCode)) {
      throw new ValidationError('Invalid metadataTypeCode', [{ field: 'metadataTypeCode', message: 'Invalid' }]);
    }
    if (!METADATA_VALUE_CODE_PATTERN.test(data.valueCode)) {
      throw new ValidationError('Invalid metadataValueCode', [{ field: 'metadataValueCode', message: 'Invalid' }]);
    }
    if (data.reason !== undefined && data.reason.length > DELETE_REASON_MAX) {
      throw new ValidationError(`reason must be at most ${DELETE_REASON_MAX} characters`, [
        { field: 'reason', message: `Max ${DELETE_REASON_MAX} characters` },
      ]);
    }

    if (!data.actionRaw) {
      return;
    }

    const action = assertRegistryDeleteMetadataValueAction(data.actionRaw);
    if (action === 'publish') {
      assertMetadataPublishRequestBody(data.body);
      return;
    }
    if (action === 'impact-preview' && isDraftImpactPreviewBody(data.body)) {
      assertChangeRequestIdPresentOnBody(data.body);
    }
  })
  .transform((data) => {
    const action = data.actionRaw ? assertRegistryDeleteMetadataValueAction(data.actionRaw) : undefined;
    return {
      metadataTypeCode: data.metadataTypeCode,
      valueCode: data.valueCode,
      userId: data.userId,
      reason: data.reason,
      action,
      body: data.body,
    };
  });

export type DeleteMetadataValueRequest = z.infer<typeof deleteMetadataValueSchema>;
